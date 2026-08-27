const IINATAN_NATIVE_SUBTITLE_HIT_LAYER = (() => {
  function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function fontMetricScaleFromWinMetrics(metricValue) {
    const metrics =
      metricValue && typeof metricValue === "object" ? metricValue : {};
    const unitsPerEm = finiteNumber(metrics.unitsPerEm, 0);
    const usWinAscent = finiteNumber(metrics.usWinAscent, -1);
    const usWinDescent = finiteNumber(metrics.usWinDescent, -1);
    const winHeight = usWinAscent + usWinDescent;
    if (
      unitsPerEm <= 0 ||
      usWinAscent < 0 ||
      usWinDescent < 0 ||
      winHeight <= 0
    )
      return null;
    const scale = unitsPerEm / winHeight;
    return Number.isFinite(scale) && scale > 0.1 && scale <= 2 ? scale : null;
  }

  function balancedTextWrapSupported(cssApi, style) {
    if (cssApi && typeof cssApi.supports === "function") {
      try {
        return (
          cssApi.supports("text-wrap", "balance") ||
          cssApi.supports("text-wrap-style", "balance")
        );
      } catch (_) {
        return false;
      }
    }
    if (!style) return false;
    try {
      if (!("textWrap" in style) && !("textWrapStyle" in style)) return false;
      const previous = style.textWrap;
      style.textWrap = "balance";
      const accepted = style.textWrap === "balance";
      style.textWrap = previous;
      return accepted;
    } catch (_) {
      return false;
    }
  }

  function rectanglesSpanMultipleLines(rectangles) {
    const lineTops = [];
    (rectangles || []).forEach((rect) => {
      const top = finiteNumber(rect && rect.top, NaN);
      if (!Number.isFinite(top)) return;
      if (!lineTops.some((candidate) => Math.abs(candidate - top) <= 1.5))
        lineTops.push(top);
    });
    return lineTops.length > 1;
  }

  function validateGeometry(osdValue, viewportValue) {
    const osd = osdValue && typeof osdValue === "object" ? osdValue : {};
    const viewport =
      viewportValue && typeof viewportValue === "object" ? viewportValue : {};
    const normalized = {
      w: finiteNumber(osd.w, 0),
      h: finiteNumber(osd.h, 0),
      ml: finiteNumber(osd.ml, 0),
      mr: finiteNumber(osd.mr, 0),
      mt: finiteNumber(osd.mt, 0),
      mb: finiteNumber(osd.mb, 0),
      par: finiteNumber(osd.par, 1),
    };
    const width = finiteNumber(viewport.width, 0);
    const height = finiteNumber(viewport.height, 0);
    if (normalized.w < 64 || normalized.h < 64 || width < 64 || height < 64)
      return { ok: false, reason: "missing-osd-dimensions" };
    if (
      normalized.ml < 0 ||
      normalized.mr < 0 ||
      normalized.mt < 0 ||
      normalized.mb < 0 ||
      normalized.ml + normalized.mr >= normalized.w ||
      normalized.mt + normalized.mb >= normalized.h
    )
      return { ok: false, reason: "missing-osd-dimensions" };
    if (normalized.par < 0.1 || normalized.par > 10)
      return { ok: false, reason: "missing-osd-dimensions" };
    const scaleX = width / normalized.w;
    const scaleY = height / normalized.h;
    const anisotropy =
      Math.abs(scaleX - scaleY) / Math.max(scaleX, scaleY, 0.0001);
    const osdAspect = normalized.w / normalized.h;
    const viewportAspect = width / height;
    const aspectDelta =
      Math.abs(osdAspect - viewportAspect) /
      Math.max(osdAspect, viewportAspect, 0.0001);
    if (anisotropy > 0.035 || aspectDelta > 0.035)
      return { ok: false, reason: "non-coextensive-overlay" };
    return {
      ok: true,
      osd: normalized,
      viewport: { width, height },
      scaleX,
      scaleY,
    };
  }

  function calculatePlainTextLayout(geometry, optionValue) {
    if (!geometry || !geometry.ok)
      return {
        ok: false,
        reason: (geometry && geometry.reason) || "missing-osd-dimensions",
      };
    const options =
      optionValue && typeof optionValue === "object" ? optionValue : {};
    const calculatedMetricScale = fontMetricScaleFromWinMetrics(options);
    const reportedMetricScale = finiteNumber(options.fontMetricScale, 0);
    if (
      !calculatedMetricScale ||
      Math.abs(calculatedMetricScale - reportedMetricScale) > 0.000001 ||
      !String(options.resolvedPostScriptName || "").trim() ||
      String(options.fontMetricSource || "") !== "coretext-libass-os2-win-v4" ||
      Number(options.fontMetricResolverVersion) !== 4 ||
      options.libassProviderVerified !== true ||
      !Number.isInteger(Number(options.resolvedFontFormat)) ||
      Number(options.resolvedFontFormat) < 1 ||
      Number(options.resolvedFontFormat) > 5
    )
      return { ok: false, reason: "font-metrics-unavailable" };
    const osd = geometry.osd;
    const videoWidth = osd.w - osd.ml - osd.mr;
    const videoHeight = osd.h - osd.mt - osd.mb;
    if (videoWidth <= 0 || videoHeight <= 0)
      return { ok: false, reason: "missing-osd-dimensions" };
    const scaleWithWindow = options.scaleWithWindow !== false;
    const scaleByWindow = options.scaleByWindow !== false;
    // Match mpv 0.38's converted-subtitle scale flags in their documented
    // order. The base scale follows the displayed video rectangle.
    let unitScale = videoHeight / 720;
    if (scaleWithWindow) unitScale *= osd.h / videoHeight;
    if (!scaleByWindow) unitScale /= osd.h / 720;
    // mpv changes converted-subtitle glyph scale separately from the libass
    // style margins, whose 720-reference remains tied to the fitted video.
    const marginScale = videoHeight / 720;
    const subtitleScale = Math.max(0.1, finiteNumber(options.scale, 1));
    const fontSizeOsd =
      Math.max(1, finiteNumber(options.fontSize, 55)) *
      subtitleScale *
      unitScale;
    const marginXOsd =
      Math.max(0, finiteNumber(options.marginX, 20)) * marginScale;
    const marginYOsd =
      Math.max(0, finiteNumber(options.marginY, 22)) * marginScale;
    const lineSpacingOsd =
      finiteNumber(options.lineSpacing, 0) * unitScale * subtitleScale;
    const spacingOsd =
      finiteNumber(options.spacing, 0) * unitScale * subtitleScale;
    const cssFontSizeOsd = fontSizeOsd * calculatedMetricScale;
    // libass advances subtitle rows by its nominal font size plus configured
    // line spacing. Keep that baseline advance independent from WebKit's
    // smaller calibrated glyph box so upper rows move upward while the
    // bottom-aligned row remains anchored.
    const cssLineHeightOsd = Math.max(1, fontSizeOsd + lineSpacingOsd);
    // libass applies sub-spacing in script/screen units after glyph shaping;
    // unlike the glyph box, it does not inherit the font's OS/2-to-em ratio.
    const cssSpacingOsd = spacingOsd;
    const useMargins = options.useMargins !== false;
    // mpv/libass uses the OSD margins as optional subtitle placement space.
    // sub-use-margins=yes permits that black-border space; disabling it keeps
    // converted text inside the video rectangle.
    const baseLeft = useMargins ? 0 : osd.ml;
    const baseRight = useMargins ? osd.w : osd.w - osd.mr;
    const baseTop = useMargins ? 0 : osd.mt;
    const baseBottom = useMargins ? osd.h : osd.h - osd.mb;
    const leftOsd = baseLeft + marginXOsd;
    const rightOsd = baseRight - marginXOsd;
    if (rightOsd <= leftOsd)
      return { ok: false, reason: "non-coextensive-overlay" };
    const position = Math.max(
      0,
      Math.min(150, finiteNumber(options.position, 100)),
    );
    const alignY = String(options.alignY || "bottom");
    const alignX = String(options.alignX || "center");
    const justifyOption = String(options.justify || "auto");
    if (
      !["top", "center", "bottom"].includes(alignY) ||
      !["left", "center", "right"].includes(alignX) ||
      !["auto", "left", "center", "right"].includes(justifyOption)
    )
      return { ok: false, reason: "unsupported-writing-mode" };
    const justify = justifyOption === "auto" ? alignX : justifyOption;
    const availableWidth = rightOsd - leftOsd;
    const transforms = [];
    const result = {
      ok: true,
      width: "max-content",
      maxWidth: availableWidth * geometry.scaleX,
      fontSize: cssFontSizeOsd * geometry.scaleY,
      lineHeight: cssLineHeightOsd * geometry.scaleY,
      letterSpacing: cssSpacingOsd * geometry.scaleX,
      textAlign: justify,
      fontWeight: options.bold === false ? "400" : "700",
      fontStyle: options.italic ? "italic" : "normal",
      fontFamily: String(options.resolvedPostScriptName),
      transform: "",
    };
    if (alignX === "left") {
      result.left = leftOsd * geometry.scaleX;
    } else if (alignX === "center") {
      result.left = ((leftOsd + rightOsd) / 2) * geometry.scaleX;
      transforms.push("translateX(-50%)");
    } else {
      result.right = (osd.w - rightOsd) * geometry.scaleX;
    }
    if (alignY === "top") {
      const topPosition = Math.max(0, Math.min(100, position));
      const positionOffset = options.positionFromTop
        ? (topPosition / 100) *
          Math.max(0, baseBottom - baseTop - marginYOsd * 2)
        : 0;
      result.top = (baseTop + marginYOsd + positionOffset) * geometry.scaleY;
      if (options.positionFromTop && topPosition > 0)
        transforms.push("translateY(-" + topPosition + "%)");
    } else if (alignY === "center") {
      result.top = ((baseTop + baseBottom) / 2) * geometry.scaleY;
      transforms.push("translateY(-50%)");
    } else {
      const positionOffset = ((position - 100) / 100) * (baseBottom - baseTop);
      result.bottom =
        (osd.h - (baseBottom - marginYOsd + positionOffset)) * geometry.scaleY;
    }
    result.transform = transforms.join(" ");
    return result;
  }

  function osdPointToCss(osd, viewport, x, y) {
    const geometry = validateGeometry(osd, viewport);
    if (!geometry.ok) return null;
    return {
      x: Number(x) * geometry.scaleX,
      y: Number(y) * geometry.scaleY,
    };
  }

  function resolveHitBoxOverlaps(rectangles, padding) {
    const pad = Math.max(0, Math.min(3, finiteNumber(padding, 2)));
    const source = rectangles || [];
    const boxes = [];
    for (let index = 0; index < source.length; index++) {
      const rect = source[index];
      if (
        !rect ||
        finiteNumber(rect.width, 0) <= 0 ||
        finiteNumber(rect.height, 0) <= 0
      )
        continue;
      const box = {
        left: finiteNumber(rect.left, 0) - pad,
        top: finiteNumber(rect.top, 0) - pad,
        right: finiteNumber(rect.right, 0) + pad,
        bottom: finiteNumber(rect.bottom, 0) + pad,
        position: rect.position,
      };
      if (rect.surface !== undefined) box.surface = rect.surface;
      boxes.push(box);
    }
    boxes.sort((a, b) => {
      const centerDelta = (a.top + a.bottom) / 2 - (b.top + b.bottom) / 2;
      if (centerDelta) return centerDelta;
      if (a.top !== b.top) return a.top - b.top;
      if (a.left !== b.left) return a.left - b.left;
      return 0;
    });
    const rows = [];
    for (let boxIndex = 0; boxIndex < boxes.length; boxIndex++) {
      const box = boxes[boxIndex];
      const height = box.bottom - box.top;
      const center = (box.top + box.bottom) / 2;
      let selected = null;
      let selectedScore = -1;
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        const row = rows[rowIndex];
        const overlap = Math.max(
          0,
          Math.min(box.bottom, row.bottom) - Math.max(box.top, row.top),
        );
        const overlapRatio =
          overlap / Math.max(1, Math.min(height, row.averageHeight));
        const centerDistance = Math.abs(center - row.center);
        const centerMatch =
          centerDistance <=
          Math.max(2, Math.min(height, row.averageHeight) * 0.35);
        if (overlapRatio < 0.3 && !centerMatch) continue;
        const score = overlapRatio * 1000 - centerDistance;
        if (score <= selectedScore) continue;
        selected = row;
        selectedScore = score;
      }
      if (!selected) {
        rows.push({
          boxes: [box],
          top: box.top,
          bottom: box.bottom,
          center,
          averageHeight: height,
        });
        continue;
      }
      selected.boxes.push(box);
      const count = selected.boxes.length;
      selected.center = (selected.center * (count - 1) + center) / count;
      selected.averageHeight =
        (selected.averageHeight * (count - 1) + height) / count;
      selected.top = Math.min(selected.top, box.top);
      selected.bottom = Math.max(selected.bottom, box.bottom);
    }
    rows.sort((a, b) => a.center - b.center || a.top - b.top);
    const output = [];
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex];
      row.boxes.sort((a, b) => a.left - b.left || a.right - b.right);
      for (let index = 1; index < row.boxes.length; index++) {
        const previous = row.boxes[index - 1];
        const current = row.boxes[index];
        if (previous.right <= current.left) continue;
        const minimum = Math.max(previous.left, current.left);
        const maximum = Math.min(previous.right, current.right);
        if (maximum <= minimum) continue;
        const midpoint = (previous.right + current.left) / 2;
        const boundary = Math.max(minimum, Math.min(maximum, midpoint));
        if (boundary <= previous.left || boundary >= current.right) continue;
        previous.right = boundary;
        current.left = boundary;
      }
      for (let boxIndex = 0; boxIndex < row.boxes.length; boxIndex++) {
        const box = row.boxes[boxIndex];
        const width = Math.max(0, box.right - box.left);
        const height = Math.max(0, box.bottom - box.top);
        if (width <= 0 || height <= 0) continue;
        const resolved = {
          left: box.left,
          top: box.top,
          width,
          height,
          position: box.position,
        };
        if (box.surface !== undefined) resolved.surface = box.surface;
        output.push(resolved);
      }
    }
    return output;
  }

  return {
    fontMetricScaleFromWinMetrics,
    balancedTextWrapSupported,
    rectanglesSpanMultipleLines,
    validateGeometry,
    calculatePlainTextLayout,
    osdPointToCss,
    resolveHitBoxOverlaps,
  };
})();
