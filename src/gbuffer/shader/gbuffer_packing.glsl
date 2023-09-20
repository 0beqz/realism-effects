uniform sampler2D gBufferTexture;

struct Material {
  vec4 diffuse;
  vec3 normal;
  float roughness;
  float metalness;
  vec3 emissive;
};

#define ONE_SAFE 0.999999

const float c_precision = 256.0;
const float c_precisionp1 = c_precision + 1.0;

// source: http://emmettmcquinn.com/blog/graphics/2012/11/07/float-packing.html
float color2float(in vec3 color) {
  color = clamp(color, 0.0, 1.0);
  return floor(color.r * c_precision + 0.5) + floor(color.b * c_precision + 0.5) * c_precisionp1 +
         floor(color.g * c_precision + 0.5) * c_precisionp1 * c_precisionp1;
}

// source: http://emmettmcquinn.com/blog/graphics/2012/11/07/float-packing.html
vec3 float2color(in float value) {
  vec3 color;
  color.r = mod(value, c_precisionp1) / c_precision;
  color.b = mod(floor(value / c_precisionp1), c_precisionp1) / c_precision;
  color.g = floor(value / (c_precisionp1 * c_precisionp1)) / c_precision;
  return color;
}

// source:
// https://knarkowicz.wordpress.com/2014/04/16/octahedron-normal-vector-encoding/
vec2 OctWrap(vec2 v) {
  vec2 w = 1.0 - abs(v.yx);
  if (v.x < 0.0)
    w.x = -w.x;
  if (v.y < 0.0)
    w.y = -w.y;
  return w;
}

vec2 encodeOctWrap(vec3 n) {
  n /= (abs(n.x) + abs(n.y) + abs(n.z));
  n.xy = n.z > 0.0 ? n.xy : OctWrap(n.xy);
  n.xy = n.xy * 0.5 + 0.5;
  return n.xy;
}

// source:
// https://knarkowicz.wordpress.com/2014/04/16/octahedron-normal-vector-encoding/
vec3 decodeOctWrap(vec2 f) {
  f = f * 2.0 - 1.0;

  // https://twitter.com/Stubbesaurus/status/937994790553227264
  vec3 n = vec3(f.x, f.y, 1.0 - abs(f.x) - abs(f.y));
  float t = max(-n.z, 0.0);
  n.x += n.x >= 0.0 ? -t : t;
  n.y += n.y >= 0.0 ? -t : t;
  return normalize(n);
}

float packNormal(vec3 normal) { return uintBitsToFloat(packHalf2x16(encodeOctWrap(normal))); }

vec3 unpackNormal(float packedNormal) { return decodeOctWrap(unpackHalf2x16(floatBitsToUint(packedNormal))); }

// not used, results in severe precision loss and artifacts on Metal backends
//  float packVec2( vec2 value) {
//   return uintBitsToFloat(packHalf2x16(value));
// }

// not used, results in severe precision loss and artifacts on Metal backends
//  vec2 unpackVec2( float packedValue) {
//   return unpackHalf2x16(floatBitsToUint(packedValue));
// }

vec4 packTwoVec4(vec4 v1, vec4 v2) {
  vec4 encoded = vec4(0.0);

  encoded.r = uintBitsToFloat(packHalf2x16(v1.rg));
  encoded.g = uintBitsToFloat(packHalf2x16(v1.ba));
  encoded.b = uintBitsToFloat(packHalf2x16(v2.rg));
  encoded.a = uintBitsToFloat(packHalf2x16(v2.ba));

  return encoded;
}

void unpackTwoVec4(vec4 encoded, out vec4 v1, out vec4 v2) {
  v1.rg = unpackHalf2x16(floatBitsToUint(encoded.r));
  v1.ba = unpackHalf2x16(floatBitsToUint(encoded.g));

  v2.rg = unpackHalf2x16(floatBitsToUint(encoded.b));
  v2.ba = unpackHalf2x16(floatBitsToUint(encoded.a));
}

// source:
// https://community.khronos.org/t/addition-of-two-hdr-rgbe-values/55669/2
vec4 encodeRGBE8(vec3 rgb) {
  vec4 vEncoded;
  float maxComponent = max(max(rgb.r, rgb.g), rgb.b);
  float fExp = ceil(log2(maxComponent));
  vEncoded.rgb = rgb / exp2(fExp);
  vEncoded.a = (fExp + 128.0) / 255.0;
  return vEncoded;
}

// source:
// https://community.khronos.org/t/addition-of-two-hdr-rgbe-values/55669/2
vec3 decodeRGBE8(vec4 rgbe) {
  vec3 vDecoded;
  float fExp = rgbe.a * 255.0 - 128.0;
  vDecoded = rgbe.rgb * exp2(fExp);
  return vDecoded;
}

float vec4ToFloat(vec4 vec) {
  uvec4 v = uvec4(vec * 255.0);
  uint value = (v.a << 24u) | (v.b << 16u) | (v.g << 8u) | (v.r);

  return uintBitsToFloat(value);
}

vec4 floatToVec4(float f) {
  uint value = floatBitsToUint(f);

  vec4 v;
  v.r = float(value & 0xFFu) / 255.0;
  v.g = float((value >> 8u) & 0xFFu) / 255.0;
  v.b = float((value >> 16u) & 0xFFu) / 255.0;
  v.a = float((value >> 24u) & 0xFFu) / 255.0;

  return v;
}

vec4 packGBuffer(vec4 diffuse, vec3 normal, float roughness, float metalness, vec3 emissive) {
  vec4 gBuffer;

  // clamp diffuse to [0;1[
  // has to be done as otherwise we get blue instead of white on Metal backends
  diffuse = clamp(diffuse, vec4(0.), vec4(ONE_SAFE));

  // clamp roughness and metalness to [0;1[
  roughness = clamp(roughness, 0.0, ONE_SAFE);
  metalness = clamp(metalness, 0.0, ONE_SAFE);

  gBuffer.r = vec4ToFloat(diffuse);
  gBuffer.g = packNormal(normal);

  // unfortunately packVec2 results in severe precision loss and artifacts for
  // the first on Metal backends thus we use color2float instead
  gBuffer.b = color2float(vec3(roughness, metalness, 0.));
  gBuffer.a = vec4ToFloat(encodeRGBE8(emissive));

  return gBuffer;
}

// loading a material from a packed g-buffer
Material getMaterial(sampler2D gBufferTexture, vec2 uv) {
  vec4 gBuffer = textureLod(gBufferTexture, uv, 0.0);

  vec4 diffuse = floatToVec4(gBuffer.r);
  diffuse = clamp(diffuse, vec4(0.), vec4(ONE_SAFE));
  vec3 normal = unpackNormal(gBuffer.g);

  // using float2color instead of unpackVec2 as the latter results in severe
  // precision loss and artifacts on Metal backends
  vec3 roughnessMetalness = float2color(gBuffer.b);
  float roughness = clamp(roughnessMetalness.r, 0., 1.);
  float metalness = clamp(roughnessMetalness.g, 0., 1.);

  vec3 emissive = decodeRGBE8(floatToVec4(gBuffer.a));

  return Material(diffuse, normal, roughness, metalness, emissive);
}

vec3 getNormal(sampler2D gBufferTexture, vec2 uv) { return unpackNormal(textureLod(gBufferTexture, uv, 0.0).g); }
