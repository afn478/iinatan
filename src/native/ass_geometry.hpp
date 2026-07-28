#pragma once

#include <string>

#include "media_demux.hpp"
#include "worker_protocol.hpp"

namespace iinatan::ass {

struct GeometryService {
  protocol::Json handle(const protocol::GeometryRequest& request);
};

const char* libass_geometry_version();
constexpr int kAssGeometryProtocol = 1;
constexpr const char* kAssGeometryPatch =
    "libass-0.17.2-iinatan-unit-ids-v1";

}  // namespace iinatan::ass
