#pragma once

#include <functional>
#include <memory>

#include "worker_protocol.hpp"

namespace iinatan::bitmap {

class OcrService {
 public:
  OcrService();
  ~OcrService();
  OcrService(const OcrService&) = delete;
  OcrService& operator=(const OcrService&) = delete;

  protocol::Json capability() const;
  protocol::Json handle(
      const protocol::Json& request,
      const std::function<bool()>& cancelled = {}) const;

 private:
  struct State;
  std::unique_ptr<State> state_;
};

bool is_ocr_request(const protocol::Json& request);
constexpr int kBitmapOcrProtocol = 1;

}  // namespace iinatan::bitmap
