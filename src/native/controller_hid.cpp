#include "controller_hid.hpp"

#include <CoreFoundation/CoreFoundation.h>
#include <IOKit/hid/IOHIDManager.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <optional>
#include <sstream>
#include <string>
#include <system_error>
#include <vector>

namespace fs = std::filesystem;

namespace iinatan::controller {
namespace {

constexpr uint32_t kGenericDesktopPage = 0x01;
constexpr uint32_t kButtonPage = 0x09;
constexpr uint32_t kJoystickUsage = 0x04;
constexpr uint32_t kGamePadUsage = 0x05;
constexpr uint32_t kMultiAxisControllerUsage = 0x08;
constexpr uint32_t kUsageX = 0x30;
constexpr uint32_t kUsageY = 0x31;
constexpr uint32_t kUsageZ = 0x32;
constexpr uint32_t kUsageRx = 0x33;
constexpr uint32_t kUsageRy = 0x34;
constexpr uint32_t kUsageRz = 0x35;
constexpr uint32_t kUsageHat = 0x39;

struct Binding {
  IOHIDElementRef element = nullptr;
  uint32_t page = 0;
  uint32_t usage = 0;
  double minimum = 0;
  double maximum = 1;
};

struct Snapshot {
  bool connected = false;
  std::array<bool, 12> buttons{};
  std::array<double, 3> axes{};
  std::string id;

  bool operator==(const Snapshot& other) const {
    return connected == other.connected && buttons == other.buttons &&
           axes == other.axes && id == other.id;
  }
};

std::string cf_string(CFTypeRef value) {
  if (!value || CFGetTypeID(value) != CFStringGetTypeID()) return {};
  CFStringRef string = static_cast<CFStringRef>(value);
  const CFIndex length = CFStringGetLength(string);
  const CFIndex capacity =
      CFStringGetMaximumSizeForEncoding(length, kCFStringEncodingUTF8) + 1;
  std::vector<char> buffer(static_cast<size_t>(std::max<CFIndex>(capacity, 1)));
  if (!CFStringGetCString(
          string, buffer.data(), static_cast<CFIndex>(buffer.size()),
          kCFStringEncodingUTF8))
    return {};
  return std::string(buffer.data());
}

int cf_int(CFTypeRef value) {
  if (!value || CFGetTypeID(value) != CFNumberGetTypeID()) return 0;
  int result = 0;
  CFNumberGetValue(static_cast<CFNumberRef>(value), kCFNumberIntType, &result);
  return result;
}

std::string json_escape(const std::string& value) {
  std::string result;
  result.reserve(value.size() + 8);
  for (const unsigned char character : value) {
    switch (character) {
      case '\\': result += "\\\\"; break;
      case '"': result += "\\\""; break;
      case '\n': result += "\\n"; break;
      case '\r': result += "\\r"; break;
      case '\t': result += "\\t"; break;
      default:
        if (character < 0x20) {
          char escaped[7];
          std::snprintf(escaped, sizeof(escaped), "\\u%04x", character);
          result += escaped;
        } else {
          result += static_cast<char>(character);
        }
    }
  }
  return result;
}

void write_atomic(const fs::path& path, const std::string& body) {
  std::error_code error;
  fs::create_directories(path.parent_path(), error);
  const fs::path temporary = path.string() + ".tmp";
  {
    std::ofstream output(temporary, std::ios::binary | std::ios::trunc);
    if (!output.is_open()) return;
    output << body;
    output.flush();
    if (!output.good()) return;
  }
  fs::rename(temporary, path, error);
  if (error) {
    fs::remove(path, error);
    error.clear();
    fs::rename(temporary, path, error);
  }
}

double read_value(const Binding& binding) {
  if (!binding.element) return binding.minimum;
  IOHIDValueRef value = nullptr;
  if (IOHIDDeviceGetValue(
          IOHIDElementGetDevice(binding.element), binding.element, &value) !=
      kIOReturnSuccess ||
      !value)
    return binding.minimum;
  return static_cast<double>(IOHIDValueGetIntegerValue(value));
}

double normalize_axis(const Binding& binding) {
  const double value = read_value(binding);
  const double minimum = binding.minimum;
  const double maximum = binding.maximum;
  if (!(maximum > minimum)) return 0;
  const double center = (minimum + maximum) * 0.5;
  const double half_range = (maximum - minimum) * 0.5;
  if (!(half_range > 0)) return 0;
  double normalized = std::clamp((value - center) / half_range, -1.0, 1.0);
  if (std::abs(normalized) < 0.02) normalized = 0;
  return std::round(normalized * 1000.0) / 1000.0;
}

bool button_down(const Binding& binding) {
  const double value = read_value(binding);
  return value > binding.minimum + (binding.maximum - binding.minimum) * 0.5;
}

}  // namespace

struct Monitor::Impl {
  explicit Impl(fs::path path) : state_path(std::move(path)) {
    manager = IOHIDManagerCreate(kCFAllocatorDefault, kIOHIDOptionsTypeNone);
    if (manager) {
      IOHIDManagerSetDeviceMatching(manager, nullptr);
      IOHIDManagerOpen(manager, kIOHIDOptionsTypeNone);
    }
  }

  ~Impl() {
    close_device();
    if (manager) {
      IOHIDManagerClose(manager, kIOHIDOptionsTypeNone);
      CFRelease(manager);
    }
  }

  void close_device() {
    if (device) {
      IOHIDDeviceClose(device, kIOHIDOptionsTypeNone);
      CFRelease(device);
      device = nullptr;
    }
    bindings.clear();
    active_id.clear();
  }

  int controller_score(IOHIDDeviceRef candidate, std::string* id) const {
    if (!candidate) return -1;
    const std::string product_name = cf_string(
        IOHIDDeviceGetProperty(candidate, CFSTR(kIOHIDProductKey)));
    const std::string manufacturer = cf_string(
        IOHIDDeviceGetProperty(candidate, CFSTR(kIOHIDManufacturerKey)));
    const int primary_page = cf_int(IOHIDDeviceGetProperty(
        candidate, CFSTR(kIOHIDPrimaryUsagePageKey)));
    const int primary_usage = cf_int(IOHIDDeviceGetProperty(
        candidate, CFSTR(kIOHIDPrimaryUsageKey)));
    const bool has_controller_usage =
        primary_page == static_cast<int>(kGenericDesktopPage) &&
        (primary_usage == static_cast<int>(kJoystickUsage) ||
         primary_usage == static_cast<int>(kGamePadUsage) ||
         primary_usage == static_cast<int>(kMultiAxisControllerUsage));
    const bool is_known_non_controller =
        primary_page == static_cast<int>(kGenericDesktopPage) &&
        (primary_usage == 0x02 || primary_usage == 0x06);
    if (is_known_non_controller) return -1;

    int button_count = 0;
    int axis_count = 0;
    bool has_hat = false;
    CFArrayRef elements = IOHIDDeviceCopyMatchingElements(
        candidate, nullptr, kIOHIDOptionsTypeNone);
    if (elements) {
      for (CFIndex index = 0; index < CFArrayGetCount(elements); ++index) {
        auto* element = static_cast<IOHIDElementRef>(const_cast<void*>(
            CFArrayGetValueAtIndex(elements, index)));
        const IOHIDElementType type = IOHIDElementGetType(element);
        if (type != kIOHIDElementTypeInput_Button &&
            type != kIOHIDElementTypeInput_Axis &&
            type != kIOHIDElementTypeInput_Misc)
          continue;
        const uint32_t page = IOHIDElementGetUsagePage(element);
        const uint32_t usage = IOHIDElementGetUsage(element);
        if (page == kButtonPage) ++button_count;
        if (page == kGenericDesktopPage &&
            (usage == kUsageX || usage == kUsageY || usage == kUsageZ ||
             usage == kUsageRx || usage == kUsageRy || usage == kUsageRz))
          ++axis_count;
        if (page == kGenericDesktopPage && usage == kUsageHat) has_hat = true;
      }
      CFRelease(elements);
    }
    // Some macOS-recognized controllers expose only generic button and
    // X/Y-axis elements, without a primary usage or hat descriptor. The
    // button/axis minimum is sufficient to distinguish those from keyboards
    // and pointing devices (which are filtered above by their primary usage).
    if (button_count < 4 || axis_count < 2) return -1;
    if (id) {
      if (!product_name.empty()) {
        *id = product_name;
      } else if (!manufacturer.empty()) {
        *id = manufacturer + " Controller";
      } else {
        *id = "Controller";
      }
    }
    int score = button_count + axis_count * 2 + (has_hat ? 4 : 0);
    if (has_controller_usage) score += 100;
    return score;
  }

  bool open_device() {
    if (!manager) return false;
    CFSetRef devices = IOHIDManagerCopyDevices(manager);
    if (!devices) return false;
    const CFIndex count = CFSetGetCount(devices);
    std::vector<const void*> values(static_cast<size_t>(count));
    CFSetGetValues(devices, values.data());
    IOHIDDeviceRef found = nullptr;
    std::string found_id;
    int found_score = -1;
    for (const void* value : values) {
      auto* candidate = static_cast<IOHIDDeviceRef>(const_cast<void*>(value));
      std::string candidate_id;
      const int score = controller_score(candidate, &candidate_id);
      if (score > found_score) {
        found = candidate;
        found_id = candidate_id;
        found_score = score;
      }
    }
    if (!found || found_score < 10) {
      CFRelease(devices);
      return false;
    }
    CFRetain(found);
    CFRelease(devices);
    if (IOHIDDeviceOpen(found, kIOHIDOptionsTypeNone) != kIOReturnSuccess) {
      CFRelease(found);
      return false;
    }
    device = found;
    active_id = found_id;
    CFArrayRef elements = IOHIDDeviceCopyMatchingElements(
        device, nullptr, kIOHIDOptionsTypeNone);
    if (elements) {
      for (CFIndex index = 0; index < CFArrayGetCount(elements); ++index) {
        auto* element = static_cast<IOHIDElementRef>(
            const_cast<void*>(CFArrayGetValueAtIndex(elements, index)));
        const IOHIDElementType type = IOHIDElementGetType(element);
        if (type != kIOHIDElementTypeInput_Button &&
            type != kIOHIDElementTypeInput_Axis &&
            type != kIOHIDElementTypeInput_Misc)
          continue;
        Binding binding;
        binding.element = element;
        binding.page = IOHIDElementGetUsagePage(element);
        binding.usage = IOHIDElementGetUsage(element);
        binding.minimum = IOHIDElementGetLogicalMin(element);
        binding.maximum = IOHIDElementGetLogicalMax(element);
        bindings.push_back(binding);
      }
      CFRelease(elements);
    }
    if (bindings.empty()) {
      close_device();
      return false;
    }
    return true;
  }

  bool device_is_present() const {
    if (!manager || !device) return false;
    CFSetRef devices = IOHIDManagerCopyDevices(manager);
    if (!devices) return false;
    const bool present = CFSetContainsValue(devices, device);
    CFRelease(devices);
    return present;
  }

  Snapshot read_snapshot() const {
    Snapshot next;
    next.connected = device != nullptr;
    next.id = active_id;
    Binding hat;
    bool has_hat = false;
    bool has_right_x_axis = false;
    bool has_right_y_axis = false;
    for (const Binding& binding : bindings) {
      if (binding.page != kGenericDesktopPage) continue;
      if (binding.usage == kUsageRx) has_right_x_axis = true;
      if (binding.usage == kUsageRy) has_right_y_axis = true;
    }
    const bool standard_right_stick = has_right_x_axis && has_right_y_axis;
    for (const Binding& binding : bindings) {
      if (binding.page == kButtonPage) {
        size_t index = next.buttons.size();
        switch (binding.usage) {
          case 1: index = 2; break;  // Square / west
          case 2: index = 0; break;  // Cross / south
          case 3: index = 1; break;  // Circle / east
          case 4: index = 3; break;  // Triangle / north
          case 5: index = 4; break;  // L1
          case 6: index = 5; break;  // R1
          case 7: index = 6; break;  // L2
          case 8: index = 7; break;  // R2
          case 9: index = 8; break;  // D-pad up when exposed as buttons
          case 10: index = 9; break;  // D-pad down when exposed as buttons
          case 11: index = 10; break;  // D-pad left when exposed as buttons
          case 12: index = 11; break;  // D-pad right when exposed as buttons
          default: break;
        }
        if (index < next.buttons.size()) next.buttons[index] = button_down(binding);
      }
      if (binding.page != kGenericDesktopPage) continue;
      switch (binding.usage) {
        case kUsageX:
          // The current snapshot contract exposes vertical left-stick motion.
          break;
        case kUsageY:
          next.axes[0] = normalize_axis(binding);
          break;
        case kUsageZ:
          if (standard_right_stick)
            next.buttons[6] = next.buttons[6] || button_down(binding);
          else
            next.axes[1] = normalize_axis(binding);
          break;
        case kUsageRx:
          if (standard_right_stick) next.axes[1] = normalize_axis(binding);
          break;
        case kUsageRy:
          if (standard_right_stick) next.axes[2] = normalize_axis(binding);
          break;
        case kUsageRz:
          if (standard_right_stick)
            next.buttons[7] = next.buttons[7] || button_down(binding);
          else
            next.axes[2] = normalize_axis(binding);
          break;
        case kUsageHat: {
          hat = binding;
          has_hat = true;
          break;
        }
        default:
          break;
      }
    }
    if (has_hat) {
      const int value = static_cast<int>(std::llround(read_value(hat)));
      const int offset = value - static_cast<int>(hat.minimum);
      const int direction = offset >= 0 && offset < 8 ? offset : -1;
      // D-pad directions are stored in button slots 8..11.
      next.buttons[8] = direction == 0 || direction == 1 || direction == 7;
      next.buttons[9] = direction == 3 || direction == 4 || direction == 5;
      next.buttons[10] = direction == 5 || direction == 6 || direction == 7;
      next.buttons[11] = direction == 1 || direction == 2 || direction == 3;
    }
    return next;
  }

  std::string snapshot_json(
      const Snapshot& snapshot, uint64_t sequence, long long updated_at) const {
    std::ostringstream output;
    output << "{\"protocol\":1,\"sequence\":" << sequence
           << ",\"updatedAt\":" << updated_at
           << ",\"source\":\"native-hid\",\"connected\":"
           << (snapshot.connected ? "true" : "false") << ",\"id\":\""
           << json_escape(snapshot.id) << "\",\"buttons\":{";
    static constexpr std::array<const char*, 12> names = {
        "primary",       "back",       "square",       "audio",
        "leftShoulder",  "rightShoulder", "leftTrigger", "rightTrigger",
        "dpadUp",        "dpadDown",   "dpadLeft",     "dpadRight"};
    for (size_t index = 0; index < names.size(); ++index) {
      if (index) output << ',';
      output << '"' << names[index] << "\":"
             << (snapshot.buttons[index] ? "true" : "false");
    }
    output << "},\"axes\":{";
    output << "\"leftY\":" << snapshot.axes[0]
           << ",\"rightX\":" << snapshot.axes[1]
           << ",\"rightY\":" << snapshot.axes[2] << "}}\n";
    return output.str();
  }

  void publish(const Snapshot& next) {
    const auto now = std::chrono::steady_clock::now();
    if (published && *published == next &&
        now - last_publish_at < std::chrono::milliseconds(250))
      return;
    published = next;
    ++sequence;
    const auto wall_now = std::chrono::duration_cast<std::chrono::milliseconds>(
                              std::chrono::system_clock::now().time_since_epoch())
                              .count();
    write_atomic(state_path, snapshot_json(next, sequence, wall_now));
    last_publish_at = now;
  }

  void poll() {
    if (device && !device_is_present()) close_device();
    if (!device && !open_device()) {
      Snapshot disconnected;
      publish(disconnected);
      return;
    }
    Snapshot next = read_snapshot();
    if (!next.connected) close_device();
    publish(next);
  }

  fs::path state_path;
  IOHIDManagerRef manager = nullptr;
  IOHIDDeviceRef device = nullptr;
  std::vector<Binding> bindings;
  std::string active_id;
  std::optional<Snapshot> published;
  uint64_t sequence = 0;
  std::chrono::steady_clock::time_point last_publish_at{};
};

Monitor::Monitor(fs::path state_path) : impl_(new Impl(std::move(state_path))) {}
Monitor::~Monitor() { delete impl_; }
void Monitor::poll() {
  if (impl_) impl_->poll();
}

}  // namespace iinatan::controller
