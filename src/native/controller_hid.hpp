#pragma once

#include <filesystem>

namespace iinatan::controller {

class Monitor {
 public:
  explicit Monitor(std::filesystem::path state_path);
  ~Monitor();

  Monitor(const Monitor&) = delete;
  Monitor& operator=(const Monitor&) = delete;

  // Poll the native HID device and publish only changed snapshots.
  void poll();

 private:
  struct Impl;
  Impl* impl_ = nullptr;
};

}  // namespace iinatan::controller
