#pragma once

#include <memory>
#include <string>

#include "media_demux.hpp"
#include "worker_protocol.hpp"

namespace iinatan::ass {

class GeometryService {
 public:
  GeometryService();
  ~GeometryService();
  GeometryService(const GeometryService&) = delete;
  GeometryService& operator=(const GeometryService&) = delete;

  protocol::Json handle(const protocol::GeometryRequest& request);

 private:
  struct State;
  std::unique_ptr<State> state_;
};

const char* libass_geometry_version();
constexpr int kAssGeometryProtocol = 1;
constexpr const char* kAssGeometryPatch =
    "libass-0.17.2-iinatan-unit-ids-v2";

}  // namespace iinatan::ass
