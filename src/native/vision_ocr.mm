#include "vision_ocr.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <filesystem>
#include <iostream>
#include <limits>
#include <optional>
#include <sys/stat.h>
#include <vector>

#import <CoreGraphics/CoreGraphics.h>
#import <Foundation/Foundation.h>
#import <ImageIO/ImageIO.h>
#import <Vision/Vision.h>

#include "bitmap_subtitle.hpp"

namespace iinatan::bitmap {
namespace {

using protocol::Json;

constexpr int kMaxImagePixels = 16'000'000;
constexpr uintmax_t kMaxImageFileBytes = 64 * 1024 * 1024;

struct Renderer {
  int width = 0;
  int height = 0;
  int storage_width = 0;
  int storage_height = 0;
  int margin_left = 0;
  int margin_right = 0;
  int margin_top = 0;
  int margin_bottom = 0;
};

struct PixelBounds {
  int left = 0;
  int top = 0;
  int right = 0;
  int bottom = 0;
  bool valid = false;
};

struct OcrUnit {
  int start_utf16 = 0;
  int end_utf16 = 0;
  double confidence = 0;
  double x = 0;
  double y = 0;
  double w = 0;
  double h = 0;
};

struct OcrResult {
  bool ok = false;
  std::string reason;
  std::string detail;
  std::string text;
  double confidence = 0;
  std::vector<OcrUnit> units;
  int64_t prepare_ms = 0;
  int64_t vision_ms = 0;
  int64_t boxes_ms = 0;
};

using Clock = std::chrono::steady_clock;

int64_t elapsed_ms(Clock::time_point start) {
  return std::chrono::duration_cast<std::chrono::milliseconds>(
             Clock::now() - start)
      .count();
}

const Json& required(const Json& object, const std::string& key) {
  const Json* value = object.find(key);
  if (!value) throw std::runtime_error("missing " + key);
  return *value;
}

Json error_response(
    const std::string& request_id, const std::string& reason,
    const std::string& detail = "") {
  Json::Object result{
      {"ok", false},
      {"protocol", kBitmapOcrProtocol},
      {"requestId", request_id},
      {"reason", reason},
  };
  if (!detail.empty()) result.emplace("detail", detail);
  return result;
}

bool valid_dimensions(int width, int height) {
  return width >= 16 && height >= 16 &&
      static_cast<int64_t>(width) * height <= kMaxImagePixels;
}

bool safe_image_path(const std::string& path, std::string& canonical) {
  if (path.empty() || path.size() > 4096 || path[0] != '/' ||
      path.find('\0') != std::string::npos)
    return false;
  std::error_code error;
  canonical = std::filesystem::canonical(path, error).string();
  if (error || canonical.empty()) return false;
  struct stat status {};
  return stat(canonical.c_str(), &status) == 0 && S_ISREG(status.st_mode) &&
      status.st_size >= 0 &&
      static_cast<uintmax_t>(status.st_size) <= kMaxImageFileBytes;
}

std::optional<Frame> load_image(const std::string& path) {
  std::string canonical;
  if (!safe_image_path(path, canonical)) return std::nullopt;
  CFURLRef url = CFURLCreateFromFileSystemRepresentation(
      kCFAllocatorDefault,
      reinterpret_cast<const UInt8*>(canonical.data()), canonical.size(),
      false);
  if (!url) return std::nullopt;
  CGImageSourceRef source = CGImageSourceCreateWithURL(url, nullptr);
  CFRelease(url);
  if (!source) return std::nullopt;
  CGImageRef image = CGImageSourceCreateImageAtIndex(source, 0, nullptr);
  CFRelease(source);
  if (!image) return std::nullopt;
  const int width = static_cast<int>(CGImageGetWidth(image));
  const int height = static_cast<int>(CGImageGetHeight(image));
  if (!valid_dimensions(width, height)) {
    CGImageRelease(image);
    return std::nullopt;
  }
  Frame frame;
  frame.width = width;
  frame.height = height;
  frame.canvas_width = width;
  frame.canvas_height = height;
  frame.rgba.assign(static_cast<size_t>(width) * height * 4, 0);
  CGColorSpaceRef color_space = CGColorSpaceCreateDeviceRGB();
  CGContextRef context = CGBitmapContextCreate(
      frame.rgba.data(), width, height, 8, width * 4, color_space,
      static_cast<CGBitmapInfo>(
          static_cast<CGBitmapInfo>(kCGImageAlphaPremultipliedLast) |
          static_cast<CGBitmapInfo>(kCGBitmapByteOrder32Big)));
  CGColorSpaceRelease(color_space);
  if (!context) {
    CGImageRelease(image);
    return std::nullopt;
  }
  CGContextTranslateCTM(context, 0, height);
  CGContextScaleCTM(context, 1, -1);
  CGContextDrawImage(context, CGRectMake(0, 0, width, height), image);
  CGContextRelease(context);
  CGImageRelease(image);
  return frame;
}

std::optional<Frame> difference_image(
    const std::string& video_path, const std::string& subtitle_path) {
  std::optional<Frame> video = load_image(video_path);
  std::optional<Frame> subtitle = load_image(subtitle_path);
  if (!video || !subtitle || video->width != subtitle->width ||
      video->height != subtitle->height)
    return std::nullopt;
  Frame result;
  result.width = subtitle->width;
  result.height = subtitle->height;
  result.canvas_width = subtitle->width;
  result.canvas_height = subtitle->height;
  result.rgba.resize(subtitle->rgba.size());
  size_t changed = 0;
  for (size_t offset = 0; offset < result.rgba.size(); offset += 4) {
    const int red = std::abs(
        static_cast<int>(subtitle->rgba[offset]) - video->rgba[offset]);
    const int green = std::abs(
        static_cast<int>(subtitle->rgba[offset + 1]) -
        video->rgba[offset + 1]);
    const int blue = std::abs(
        static_cast<int>(subtitle->rgba[offset + 2]) -
        video->rgba[offset + 2]);
    const int delta = std::max({red, green, blue});
    const uint8_t alpha = delta >= 12 ? 255 : 0;
    result.rgba[offset] = subtitle->rgba[offset];
    result.rgba[offset + 1] = subtitle->rgba[offset + 1];
    result.rgba[offset + 2] = subtitle->rgba[offset + 2];
    result.rgba[offset + 3] = alpha;
    changed += alpha != 0;
  }
  if (changed < 8 || changed > result.rgba.size() / 8) return std::nullopt;
  return result;
}

PixelBounds alpha_bounds(const Frame& frame) {
  PixelBounds bounds;
  bounds.left = frame.width;
  bounds.top = frame.height;
  for (int y = 0; y < frame.height; ++y) {
    for (int x = 0; x < frame.width; ++x) {
      const uint8_t alpha = frame.rgba[
          (static_cast<size_t>(y) * frame.width + x) * 4 + 3];
      if (alpha < 8) continue;
      bounds.valid = true;
      bounds.left = std::min(bounds.left, x);
      bounds.top = std::min(bounds.top, y);
      bounds.right = std::max(bounds.right, x + 1);
      bounds.bottom = std::max(bounds.bottom, y + 1);
    }
  }
  if (bounds.valid) {
    bounds.left = std::max(0, bounds.left - 4);
    bounds.top = std::max(0, bounds.top - 4);
    bounds.right = std::min(frame.width, bounds.right + 4);
    bounds.bottom = std::min(frame.height, bounds.bottom + 4);
  }
  return bounds;
}

class AlphaPrefix {
 public:
  explicit AlphaPrefix(const Frame& frame)
      : width_(frame.width), height_(frame.height),
        values_(static_cast<size_t>(width_ + 1) * (height_ + 1), 0) {
    for (int y = 0; y < height_; ++y) {
      uint32_t row = 0;
      for (int x = 0; x < width_; ++x) {
        row += frame.rgba[
                   (static_cast<size_t>(y) * width_ + x) * 4 + 3] >= 8;
        values_[static_cast<size_t>(y + 1) * (width_ + 1) + x + 1] =
            values_[static_cast<size_t>(y) * (width_ + 1) + x + 1] + row;
      }
    }
  }

  bool any(int left, int top, int right, int bottom) const {
    left = std::clamp(left, 0, width_);
    right = std::clamp(right, 0, width_);
    top = std::clamp(top, 0, height_);
    bottom = std::clamp(bottom, 0, height_);
    if (right <= left || bottom <= top) return false;
    const size_t stride = static_cast<size_t>(width_ + 1);
    return values_[static_cast<size_t>(bottom) * stride + right] -
        values_[static_cast<size_t>(top) * stride + right] -
        values_[static_cast<size_t>(bottom) * stride + left] +
        values_[static_cast<size_t>(top) * stride + left] > 0;
  }

 private:
  int width_ = 0;
  int height_ = 0;
  std::vector<uint32_t> values_;
};

PixelBounds tighten_bounds(
    const Frame& frame, const AlphaPrefix& alpha, double x, double y,
    double w, double h) {
  PixelBounds result;
  const int left = std::max(0, static_cast<int>(std::floor(x)));
  const int top = std::max(0, static_cast<int>(std::floor(y)));
  const int right = std::min(
      frame.width, static_cast<int>(std::ceil(x + w)));
  const int bottom = std::min(
      frame.height, static_cast<int>(std::ceil(y + h)));
  if (!alpha.any(left, top, right, bottom)) {
    result = {left, top, right, bottom, right > left && bottom > top};
  } else {
    result.valid = true;
    result.left = left;
    while (result.left < right &&
           !alpha.any(result.left, top, result.left + 1, bottom))
      ++result.left;
    result.right = right;
    while (result.right > result.left &&
           !alpha.any(result.right - 1, top, result.right, bottom))
      --result.right;
    result.top = top;
    while (result.top < bottom &&
           !alpha.any(result.left, result.top, result.right, result.top + 1))
      ++result.top;
    result.bottom = bottom;
    while (result.bottom > result.top &&
           !alpha.any(
               result.left, result.bottom - 1, result.right, result.bottom))
      --result.bottom;
    result.left = std::max(0, result.left - 1);
    result.top = std::max(0, result.top - 1);
    result.right = std::min(frame.width, result.right + 1);
    result.bottom = std::min(frame.height, result.bottom + 1);
  }
  return result;
}

std::optional<Frame> ocr_crop(
    const Frame& source, const PixelBounds& bounds) {
  if (!bounds.valid || bounds.right <= bounds.left ||
      bounds.bottom <= bounds.top)
    return std::nullopt;
  Frame crop;
  crop.width = bounds.right - bounds.left;
  crop.height = bounds.bottom - bounds.top;
  crop.rgba.resize(static_cast<size_t>(crop.width) * crop.height * 4);
  uint64_t luminance = 0;
  size_t visible = 0;
  for (int y = 0; y < crop.height; ++y) {
    for (int x = 0; x < crop.width; ++x) {
      const uint8_t* pixel = source.rgba.data() +
          (static_cast<size_t>(bounds.top + y) * source.width +
           bounds.left + x) * 4;
      if (pixel[3] >= 8) {
        luminance += 299 * pixel[0] + 587 * pixel[1] + 114 * pixel[2];
        ++visible;
      }
    }
  }
  const uint8_t background =
      visible && luminance / visible >= 128000 ? 0 : 255;
  for (int y = 0; y < crop.height; ++y) {
    for (int x = 0; x < crop.width; ++x) {
      const uint8_t* source_pixel = source.rgba.data() +
          (static_cast<size_t>(bounds.top + y) * source.width +
           bounds.left + x) * 4;
      uint8_t* target = crop.rgba.data() +
          (static_cast<size_t>(y) * crop.width + x) * 4;
      const int alpha = source_pixel[3];
      for (int channel = 0; channel < 3; ++channel)
        target[channel] = static_cast<uint8_t>(
            (source_pixel[channel] * alpha + background * (255 - alpha)) /
            255);
      target[3] = 255;
    }
  }
  return crop;
}

CGImageRef make_image(const Frame& frame) {
  CGColorSpaceRef color_space = CGColorSpaceCreateDeviceRGB();
  CGDataProviderRef provider = CGDataProviderCreateWithData(
      nullptr, frame.rgba.data(), frame.rgba.size(), nullptr);
  if (!color_space || !provider) {
    if (provider) CGDataProviderRelease(provider);
    if (color_space) CGColorSpaceRelease(color_space);
    return nullptr;
  }
  CGImageRef image = CGImageCreate(
      frame.width, frame.height, 8, 32, frame.width * 4, color_space,
      static_cast<CGBitmapInfo>(
          static_cast<CGBitmapInfo>(kCGImageAlphaLast) |
          static_cast<CGBitmapInfo>(kCGBitmapByteOrder32Big)),
      provider, nullptr, false,
      kCGRenderingIntentDefault);
  CGDataProviderRelease(provider);
  CGColorSpaceRelease(color_space);
  return image;
}

std::string ns_utf8(NSString* value) {
  if (!value) return "";
  const char* bytes = value.UTF8String;
  return bytes ? std::string(bytes) : std::string();
}

NSArray<NSString*>* language_array(const std::vector<std::string>& values) {
  NSMutableArray<NSString*>* result = [NSMutableArray array];
  for (const std::string& value : values) {
    NSString* language = [NSString stringWithUTF8String:value.c_str()];
    if (language) [result addObject:language];
  }
  return result;
}

OcrResult recognize(
    const Frame& source, VNRecognizeTextRequest* request) {
  @autoreleasepool {
    const auto prepare_start = Clock::now();
    const PixelBounds crop_bounds = alpha_bounds(source);
    std::optional<Frame> crop = ocr_crop(source, crop_bounds);
    if (!crop) return {false, "empty-subtitle-image"};
    CGImageRef image = make_image(*crop);
    if (!image) return {false, "ocr-image-create-failed"};
    VNImageRequestHandler* handler =
        [[VNImageRequestHandler alloc] initWithCGImage:image options:@{}];
    OcrResult result;
    result.prepare_ms = elapsed_ms(prepare_start);
    NSError* error = nil;
    const auto vision_start = Clock::now();
    const BOOL performed = [handler performRequests:@[request] error:&error];
    result.vision_ms = elapsed_ms(vision_start);
    CGImageRelease(image);
    if (!performed) {
      result.reason = "vision-request-failed";
      result.detail = ns_utf8(error.localizedDescription);
      return result;
    }

    NSArray<VNRecognizedTextObservation*>* observations = request.results;
    observations = [observations sortedArrayUsingComparator:^NSComparisonResult(
        VNRecognizedTextObservation* left, VNRecognizedTextObservation* right) {
      const double left_top = CGRectGetMaxY(left.boundingBox);
      const double right_top = CGRectGetMaxY(right.boundingBox);
      if (std::abs(left_top - right_top) > 0.02)
        return left_top > right_top ? NSOrderedAscending : NSOrderedDescending;
      const double left_x = CGRectGetMinX(left.boundingBox);
      const double right_x = CGRectGetMinX(right.boundingBox);
      if (left_x == right_x) return NSOrderedSame;
      return left_x < right_x ? NSOrderedAscending : NSOrderedDescending;
    }];
    result.ok = true;
    const auto boxes_start = Clock::now();
    const AlphaPrefix alpha(source);
    int utf16_offset = 0;
    double confidence_total = 0;
    int confidence_count = 0;
    for (VNRecognizedTextObservation* observation in observations) {
      VNRecognizedText* candidate = [observation topCandidates:1].firstObject;
      if (!candidate || candidate.string.length == 0) continue;
      if (!result.text.empty()) {
        result.text += "\n";
        ++utf16_offset;
      }
      result.text += ns_utf8(candidate.string);
      confidence_total += candidate.confidence;
      ++confidence_count;
      NSUInteger character_offset = 0;
      while (character_offset < candidate.string.length) {
        const NSRange range =
            [candidate.string rangeOfComposedCharacterSequenceAtIndex:
                                  character_offset];
        NSString* substring = [candidate.string substringWithRange:range];
        character_offset = NSMaxRange(range);
        if (substring.length == 0 ||
            [substring rangeOfCharacterFromSet:
                NSCharacterSet.whitespaceAndNewlineCharacterSet].length ==
                substring.length)
          continue;
        NSError* box_error = nil;
        VNRectangleObservation* box =
            [candidate boundingBoxForRange:range error:&box_error];
        CGRect normalized = box ? box.boundingBox : observation.boundingBox;
        const double x = crop_bounds.left +
            CGRectGetMinX(normalized) * crop->width;
        const double y = crop_bounds.top +
            (1.0 - CGRectGetMaxY(normalized)) * crop->height;
        const double w = CGRectGetWidth(normalized) * crop->width;
        const double h = CGRectGetHeight(normalized) * crop->height;
        const PixelBounds tightened =
            tighten_bounds(source, alpha, x, y, w, h);
        if (!tightened.valid) continue;
        result.units.push_back({
            utf16_offset + static_cast<int>(range.location),
            utf16_offset + static_cast<int>(NSMaxRange(range)),
            candidate.confidence,
            static_cast<double>(tightened.left),
            static_cast<double>(tightened.top),
            static_cast<double>(tightened.right - tightened.left),
            static_cast<double>(tightened.bottom - tightened.top),
        });
      }
      utf16_offset += static_cast<int>(candidate.string.length);
    }
    if (result.text.empty() || result.units.empty()) {
      result.ok = false;
      result.reason = "vision-no-text";
      result.boxes_ms = elapsed_ms(boxes_start);
      return result;
    }
    result.confidence = confidence_count
        ? confidence_total / confidence_count
        : 0;
    result.boxes_ms = elapsed_ms(boxes_start);
    return result;
  }
}

Renderer parse_renderer(const Json& request) {
  const Json& value = required(request, "renderer");
  Renderer renderer;
  renderer.width = static_cast<int>(required(value, "width").integer());
  renderer.height = static_cast<int>(required(value, "height").integer());
  renderer.storage_width = static_cast<int>(
      value.find("storageWidth")
          ? value.find("storageWidth")->integer()
          : renderer.width);
  renderer.storage_height = static_cast<int>(
      value.find("storageHeight")
          ? value.find("storageHeight")->integer()
          : renderer.height);
  if (const Json* margin = value.find("marginLeft"))
    renderer.margin_left = static_cast<int>(margin->integer());
  if (const Json* margin = value.find("marginRight"))
    renderer.margin_right = static_cast<int>(margin->integer());
  if (const Json* margin = value.find("marginTop"))
    renderer.margin_top = static_cast<int>(margin->integer());
  if (const Json* margin = value.find("marginBottom"))
    renderer.margin_bottom = static_cast<int>(margin->integer());
  if (!valid_dimensions(renderer.width, renderer.height) ||
      !valid_dimensions(renderer.storage_width, renderer.storage_height) ||
      renderer.margin_left < 0 || renderer.margin_right < 0 ||
      renderer.margin_top < 0 || renderer.margin_bottom < 0 ||
      renderer.margin_left + renderer.margin_right >= renderer.width ||
      renderer.margin_top + renderer.margin_bottom >= renderer.height)
    throw std::runtime_error("invalid renderer");
  return renderer;
}

std::vector<std::string> parse_languages(const Json& request) {
  const Json& values = required(request, "languages");
  if (!values.is_array() || values.array().empty() || values.array().size() > 4)
    throw std::runtime_error("invalid languages");
  std::vector<std::string> result;
  for (const Json& value : values.array()) {
    const std::string language = value.string();
    if (language.empty() || language.size() > 32)
      throw std::runtime_error("invalid language");
    result.push_back(language);
  }
  return result;
}

bool contains(const std::vector<std::string>& values, const std::string& value) {
  return std::find(values.begin(), values.end(), value) != values.end();
}

Json capability_json(
    NSUInteger revision, const std::vector<std::string>& languages) {
  Json::Array language_values;
  for (const std::string& language : languages)
    language_values.emplace_back(language);
  Json::Array decoder_values;
  for (const std::string& decoder : available_decoders())
    decoder_values.emplace_back(decoder);
  return Json::Object{
      {"protocol", kBitmapOcrProtocol},
      {"available", !languages.empty()},
      {"revision", static_cast<int64_t>(revision)},
      {"languages", std::move(language_values)},
      {"decoders", std::move(decoder_values)},
      {"screenshotDiff", true},
  };
}

}  // namespace

struct OcrService::State {
  NSUInteger revision = 0;
  std::vector<std::string> languages;
  std::vector<std::string> configured_languages;
  __strong VNRecognizeTextRequest* request = nil;
};

OcrService::OcrService() : state_(std::make_unique<State>()) {
  @autoreleasepool {
    state_->revision = VNRecognizeTextRequest.currentRevision;
    state_->request = [[VNRecognizeTextRequest alloc] init];
    state_->request.revision = state_->revision;
    state_->request.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
    state_->request.usesLanguageCorrection = NO;
    state_->request.minimumTextHeight = 1.0 / 32.0;
    NSError* error = nil;
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
    NSArray<NSString*>* supported =
        [VNRecognizeTextRequest
            supportedRecognitionLanguagesForTextRecognitionLevel:
                VNRequestTextRecognitionLevelAccurate
                                                     revision:state_->revision
                                                        error:&error];
#pragma clang diagnostic pop
    for (NSString* language in supported) {
      const std::string value = ns_utf8(language);
      if (!value.empty()) state_->languages.push_back(value);
    }
  }
}

OcrService::~OcrService() = default;

Json OcrService::capability() const {
  return capability_json(state_->revision, state_->languages);
}

bool is_ocr_request(const Json& request) {
  const Json* type = request.find("type");
  return type && type->is_string() &&
      type->string() == "bitmap-subtitle-ocr";
}

Json OcrService::handle(
    const Json& request, const std::function<bool()>& cancelled) const {
  std::string request_id;
  const auto total_start = Clock::now();
  try {
    if (!request.is_object()) throw std::runtime_error("request must be object");
    if (required(request, "protocol").integer() != kBitmapOcrProtocol)
      throw std::runtime_error("unsupported bitmap OCR protocol");
    request_id = required(request, "requestId").string();
    if (request_id.empty() || request_id.size() > 128)
      throw std::runtime_error("invalid requestId");
    const Renderer renderer = parse_renderer(request);
    const std::vector<std::string> languages = parse_languages(request);
    for (const std::string& language : languages)
      if (!contains(state_->languages, language))
        return error_response(request_id, "unsupported-recognition-language");
    const std::string mode = required(request, "mode").string();
    if (cancelled && cancelled())
      return error_response(request_id, "bitmap-ocr-superseded");
    Frame frame;
    DecodeMetrics decode_metrics;
    std::string codec;
    int stream_index = -1;
    if (mode == "decoded-subtitle") {
      const Json& source = required(request, "source");
      SourceRequest source_request;
      source_request.path = required(source, "path").string();
      source_request.ff_index =
          static_cast<int>(required(source, "ffIndex").integer());
      source_request.auto_stream =
          source.find("autoBitmapStream") &&
          source.find("autoBitmapStream")->boolean_or(false);
      source_request.cache_excerpt =
          source.find("cacheExcerpt") &&
          source.find("cacheExcerpt")->boolean_or(false);
      const int64_t time_ms = required(request, "timeMs").integer();
      const int64_t cue_start_ms = required(request, "cueStartMs").integer();
      const int64_t cue_end_ms = required(request, "cueEndMs").integer();
      DecodeResult decoded = decode_subtitle_at(
          source_request, time_ms, cue_start_ms, cue_end_ms, cancelled);
      decode_metrics = decoded.metrics;
      if (!decoded.ok) {
        std::cerr << "bitmap OCR timing request=" << request_id
                  << " mode=decoded-subtitle result=" << decoded.reason
                  << " strategy=" << decode_metrics.strategy
                  << " sessionReused=" << decode_metrics.session_reused
                  << " cacheHit=" << decode_metrics.cache_hit
                  << " cancelled=" << decode_metrics.cancelled
                  << " openMs=" << decode_metrics.open_ms
                  << " probeMs=" << decode_metrics.probe_ms
                  << " seekMs=" << decode_metrics.seek_ms
                  << " demuxMs=" << decode_metrics.demux_ms
                  << " composeMs=" << decode_metrics.compose_ms
                  << " packets=" << decode_metrics.packets
                  << " selectedBytes=" << decode_metrics.packet_bytes
                  << " totalMs=" << elapsed_ms(total_start) << "\n";
        return error_response(request_id, decoded.reason, decoded.detail);
      }
      codec = decoded.codec;
      stream_index = decoded.stream_index;
      frame = std::move(decoded.frame);
    } else if (mode == "screenshot-diff") {
      const Json& images = required(request, "images");
      std::optional<Frame> difference = difference_image(
          required(images, "video").string(),
          required(images, "subtitles").string());
      if (!difference)
        return error_response(request_id, "screenshot-diff-unavailable");
      frame = std::move(*difference);
    } else {
      throw std::runtime_error("invalid bitmap OCR mode");
    }

    if (cancelled && cancelled())
      return error_response(request_id, "bitmap-ocr-superseded");
    if (state_->configured_languages != languages) {
      state_->request.recognitionLanguages = language_array(languages);
      state_->configured_languages = languages;
    }
    OcrResult recognized = recognize(frame, state_->request);
    if (!recognized.ok) {
      std::cerr << "bitmap OCR timing request=" << request_id
                << " mode=" << mode << " result=" << recognized.reason
                << " revision=" << state_->revision
                << " strategy=" << decode_metrics.strategy
                << " prepareMs=" << recognized.prepare_ms
                << " visionMs=" << recognized.vision_ms
                << " boxesMs=" << recognized.boxes_ms
                << " totalMs=" << elapsed_ms(total_start) << "\n";
      return error_response(request_id, recognized.reason, recognized.detail);
    }
    const double source_width = frame.canvas_width > 0
        ? frame.canvas_width
        : frame.width;
    const double source_height = frame.canvas_height > 0
        ? frame.canvas_height
        : frame.height;
    double target_x = static_cast<double>(renderer.margin_left);
    double target_y = static_cast<double>(renderer.margin_top);
    const double target_width =
        renderer.width - renderer.margin_left - renderer.margin_right;
    const double target_height =
        renderer.height - renderer.margin_top - renderer.margin_bottom;
    double mapped_width = target_width;
    double mapped_height = target_height;
    if (mode == "decoded-subtitle") {
      const double fit_scale = std::min(
          renderer.storage_width / source_width,
          renderer.storage_height / source_height);
      const double fitted_width = source_width * fit_scale;
      const double fitted_height = source_height * fit_scale;
      target_x +=
          (renderer.storage_width - fitted_width) * 0.5 *
          target_width / renderer.storage_width;
      target_y +=
          (renderer.storage_height - fitted_height) * 0.5 *
          target_height / renderer.storage_height;
      mapped_width = fitted_width * target_width / renderer.storage_width;
      mapped_height =
          fitted_height * target_height / renderer.storage_height;
    }
    Json::Array unit_values;
    const auto mapping_start = Clock::now();
    for (const OcrUnit& unit : recognized.units) {
      const double source_x = frame.origin_x + unit.x;
      const double source_y = frame.origin_y + unit.y;
      const double x = target_x + source_x * mapped_width / source_width;
      const double y = target_y + source_y * mapped_height / source_height;
      const double width = unit.w * mapped_width / source_width;
      const double height = unit.h * mapped_height / source_height;
      if (width <= 0 || height <= 0 || x < 0 || y < 0 ||
          x + width > renderer.width + 0.5 ||
          y + height > renderer.height + 0.5)
        continue;
      unit_values.emplace_back(Json::Object{
          {"displayStartUtf16", unit.start_utf16},
          {"displayEndUtf16", unit.end_utf16},
          {"confidence", unit.confidence},
          {"rects", Json::Array{Json::Object{
                        {"x", x}, {"y", y}, {"w", width}, {"h", height}}}},
      });
    }
    if (unit_values.empty())
      return error_response(request_id, "vision-no-usable-boxes");
    const int64_t mapping_ms = elapsed_ms(mapping_start);
    Json::Object response{
        {"ok", true},
        {"protocol", kBitmapOcrProtocol},
        {"requestId", request_id},
        {"mode", mode},
        {"text", recognized.text},
        {"confidence", recognized.confidence},
        {"rendererWidth", renderer.width},
        {"rendererHeight", renderer.height},
        {"sourceWidth", static_cast<int64_t>(source_width)},
        {"sourceHeight", static_cast<int64_t>(source_height)},
        {"cueStartMs", frame.start_ms},
        {"cueEndMs", frame.end_ms},
        {"units", std::move(unit_values)},
    };
    if (!codec.empty()) response.emplace("codec", codec);
    if (stream_index >= 0) response.emplace("streamIndex", stream_index);
    std::cerr << "bitmap OCR timing request=" << request_id
              << " mode=" << mode << " result=ok"
              << " revision=" << state_->revision
              << " strategy=" << decode_metrics.strategy
              << " sessionReused=" << decode_metrics.session_reused
              << " cacheHit=" << decode_metrics.cache_hit
              << " cancelled=" << decode_metrics.cancelled
              << " openMs=" << decode_metrics.open_ms
              << " probeMs=" << decode_metrics.probe_ms
              << " seekMs=" << decode_metrics.seek_ms
              << " demuxMs=" << decode_metrics.demux_ms
              << " composeMs=" << decode_metrics.compose_ms
              << " prepareMs=" << recognized.prepare_ms
              << " visionMs=" << recognized.vision_ms
              << " boxesMs=" << recognized.boxes_ms
              << " mappingMs=" << mapping_ms
              << " packets=" << decode_metrics.packets
              << " selectedBytes=" << decode_metrics.packet_bytes
              << " totalMs=" << elapsed_ms(total_start) << "\n";
    return response;
  } catch (const std::exception& error) {
    return error_response(request_id, "invalid-bitmap-ocr-request", error.what());
  }
}

}  // namespace iinatan::bitmap
