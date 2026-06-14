const IINATAN_DEINFLECTION = (() => {
  function arrayOf(value) {
    return Array.isArray(value) ? value : value ? [value] : [];
  }

  function conditionDefaults(descriptor) {
    const out = Object.create(null);
    (descriptor.conditions || []).forEach((condition) => {
      if (condition.isDefault !== false) out[condition.name] = true;
      (condition.subconditions || []).forEach((sub) => {
        if (sub.isDefault) out[sub.name] = true;
      });
    });
    return out;
  }

  function conditionsMatch(active, required) {
    const names = arrayOf(required);
    if (!names.length) return true;
    return names.some((name) => !!active[name]);
  }

  function nextConditions(active, outNames) {
    const names = arrayOf(outNames);
    if (!names.length) return Object.assign(Object.create(null), active);
    const out = Object.create(null);
    names.forEach((name) => {
      out[name] = true;
    });
    return out;
  }

  function conditionsKey(conditions) {
    return Object.keys(conditions || {})
      .sort()
      .join(",");
  }

  function suffixInflection(
    inflectedSuffix,
    deinflectedSuffix,
    conditionsIn,
    conditionsOut,
    reason,
  ) {
    return {
      type: "suffix",
      inflected: String(inflectedSuffix || ""),
      deinflected: String(deinflectedSuffix || ""),
      conditionsIn: arrayOf(conditionsIn),
      conditionsOut: arrayOf(conditionsOut),
      reason: reason || "suffix:" + inflectedSuffix + ">" + deinflectedSuffix,
    };
  }

  function prefixInflection(
    inflectedPrefix,
    deinflectedPrefix,
    conditionsIn,
    conditionsOut,
    reason,
  ) {
    return {
      type: "prefix",
      inflected: String(inflectedPrefix || ""),
      deinflected: String(deinflectedPrefix || ""),
      conditionsIn: arrayOf(conditionsIn),
      conditionsOut: arrayOf(conditionsOut),
      reason: reason || "prefix:" + inflectedPrefix + ">" + deinflectedPrefix,
    };
  }

  function wholeWordInflection(
    inflectedWord,
    deinflectedWord,
    conditionsIn,
    conditionsOut,
    reason,
  ) {
    return {
      type: "whole",
      inflected: String(inflectedWord || ""),
      deinflected: String(deinflectedWord || ""),
      conditionsIn: arrayOf(conditionsIn),
      conditionsOut: arrayOf(conditionsOut),
      reason: reason || "whole:" + inflectedWord + ">" + deinflectedWord,
    };
  }

  function customInflection(apply, conditionsIn, conditionsOut, reason) {
    return {
      type: "custom",
      apply,
      conditionsIn: arrayOf(conditionsIn),
      conditionsOut: arrayOf(conditionsOut),
      reason: reason || "custom",
    };
  }

  function applyRule(text, rule) {
    if (rule.type === "suffix") {
      if (!rule.inflected || !text.endsWith(rule.inflected)) return [];
      return [
        text.slice(0, text.length - rule.inflected.length) + rule.deinflected,
      ];
    }
    if (rule.type === "prefix") {
      if (!rule.inflected || !text.startsWith(rule.inflected)) return [];
      return [rule.deinflected + text.slice(rule.inflected.length)];
    }
    if (rule.type === "whole") {
      return text === rule.inflected ? [rule.deinflected] : [];
    }
    if (rule.type === "custom" && typeof rule.apply === "function") {
      const applied = rule.apply(text);
      return Array.isArray(applied) ? applied : applied ? [applied] : [];
    }
    return [];
  }

  function createTransformer(descriptor) {
    const defaults = conditionDefaults(descriptor || {});
    const rules = (descriptor && descriptor.rules) || [];
    const maxResults = Math.max(1, (descriptor && descriptor.maxResults) || 96);
    const maxDepth = Math.max(1, (descriptor && descriptor.maxDepth) || 4);

    function transform(sourceText) {
      const source = String(sourceText || "");
      if (!source) return [];
      const results = [
        {
          text: source,
          conditions: Object.assign(Object.create(null), defaults),
          trace: [],
        },
      ];
      const seen = Object.create(null);
      seen[source + "\t" + conditionsKey(defaults)] = true;
      for (let i = 0; i < results.length && results.length < maxResults; i++) {
        const current = results[i];
        if (current.trace.length >= maxDepth) continue;
        for (let r = 0; r < rules.length && results.length < maxResults; r++) {
          const rule = rules[r];
          if (!conditionsMatch(current.conditions, rule.conditionsIn)) continue;
          const applied = applyRule(current.text, rule);
          for (
            let a = 0;
            a < applied.length && results.length < maxResults;
            a++
          ) {
            const text = String(applied[a] || "");
            if (!text || text === current.text) continue;
            const conditions = nextConditions(
              current.conditions,
              rule.conditionsOut,
            );
            const trace = current.trace.concat([
              rule.reason || rule.type || "rule",
            ]);
            const key =
              text + "\t" + conditionsKey(conditions) + "\t" + trace.join("|");
            if (seen[key]) continue;
            seen[key] = true;
            results.push({ text, conditions, trace });
          }
        }
      }
      return results;
    }

    return { transform };
  }

  function appendTransforms(
    list,
    seen,
    baseCandidate,
    transformer,
    language,
    maxDerived,
  ) {
    if (
      !transformer ||
      typeof transformer.transform !== "function" ||
      !baseCandidate ||
      !baseCandidate.text
    )
      return;
    const transformed = transformer.transform(baseCandidate.text);
    const limit = Math.max(1, Number(maxDerived) || 24);
    let added = 0;
    for (let i = 0; i < transformed.length && added < limit; i++) {
      const result = transformed[i];
      if (!result || !result.text || result.text === baseCandidate.text)
        continue;
      IINATAN_LANGUAGE_COMMON.pushUniqueCandidate(list, seen, {
        text: result.text,
        normalizedText: result.text,
        source: "deinflection",
        reason:
          result.trace && result.trace.length
            ? result.trace.join(" -> ")
            : "deinflected",
        deinflectedFrom: baseCandidate.text,
        deinflectionTrace: result.trace || [],
        language,
        displayText: baseCandidate.displayText,
        range: baseCandidate.range,
      });
      added++;
    }
  }

  return {
    suffixInflection,
    prefixInflection,
    wholeWordInflection,
    customInflection,
    createTransformer,
    appendTransforms,
  };
})();
