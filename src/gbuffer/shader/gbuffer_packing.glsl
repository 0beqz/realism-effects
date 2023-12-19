uniform highp sampler2D gBufferTexture;

struct Material {
  highp vec4 diffuse;
  highp vec3 normal;
  highp float roughness;
  highp float metalness;
  highp vec3 emissive;
};

#define ONE_SAFE 0.999999

const highp float c_precision = 256.0;
const highp float c_precisionp1 = c_precision + 1.0;

highp float color2float(in highp vec3 color) {
  color = clamp(color, 0.0, 1.0);
  return floor(color.r * c_precision + 0.5) + floor(color.b * c_precision + 0.5) * c_precisionp1 +
         floor(color.g * c_precision + 0.5) * c_precisionp1 * c_precisionp1;
}

highp vec3 float2color(in highp float value) {
  highp vec3 color;
  color.r = mod(value, c_precisionp1) / c_precision;
  color.b = mod(floor(value / c_precisionp1), c_precisionp1) / c_precision;
  color.g = floor(value / (c_precisionp1 * c_precisionp1)) / c_precision;
  return color;
}

highp vec2 OctWrap(highp vec2 v) {
  highp vec2 w = 1.0 - abs(v.yx);
  if (v.x < 0.0)
    w.x = -w.x;
  if (v.y < 0.0)
    w.y = -w.y;
  return w;
}

highp vec2 encodeOctWrap(highp vec3 n) {
  n /= (abs(n.x) + abs(n.y) + abs(n.z));
  n.xy = n.z > 0.0 ? n.xy : OctWrap(n.xy);
  n.xy = n.xy * 0.5 + 0.5;
  return n.xy;
}

highp vec3 decodeOctWrap(highp vec2 f) {
  f = f * 2.0 - 1.0;
  highp vec3 n = vec3(f.x, f.y, 1.0 - abs(f.x) - abs(f.y));
  highp float t = max(-n.z, 0.0);
  n.x += n.x >= 0.0 ? -t : t;
  n.y += n.y >= 0.0 ? -t : t;
  return normalize(n);
}

highp float packNormal(highp vec3 normal) { return uintBitsToFloat(packHalf2x16(encodeOctWrap(normal))); }

highp vec3 unpackNormal(highp float packedNormal) { return decodeOctWrap(unpackHalf2x16(floatBitsToUint(packedNormal))); }

highp vec4 packTwoVec4(highp vec4 v1, highp vec4 v2) {
  // note: we get artifacts on some back-ends such as v2 = vec3(1., 0., 0.) being decoded as black (only applies for v2 and red channel)
  highp vec4 encoded = vec4(0.0);

  highp uint v1r = packHalf2x16(v1.rg);
  highp uint v1g = packHalf2x16(v1.ba);
  highp uint v2r = packHalf2x16(v2.rg);
  highp uint v2g = packHalf2x16(v2.ba);

  encoded.r = uintBitsToFloat(v1r);
  encoded.g = uintBitsToFloat(v1g);
  encoded.b = uintBitsToFloat(v2r);
  encoded.a = uintBitsToFloat(v2g);

  return encoded;
}

void unpackTwoVec4(highp vec4 encoded, out highp vec4 v1, out highp vec4 v2) {
  highp uint r = floatBitsToUint(encoded.r);
  highp uint g = floatBitsToUint(encoded.g);
  highp uint b = floatBitsToUint(encoded.b);
  highp uint a = floatBitsToUint(encoded.a);

  v1.rg = unpackHalf2x16(r);
  v1.ba = unpackHalf2x16(g);
  v2.rg = unpackHalf2x16(b);
  v2.ba = unpackHalf2x16(a);
}

highp vec4 encodeRGBE8(highp vec3 rgb) {
  highp vec4 vEncoded;
  highp float maxComponent = max(max(rgb.r, rgb.g), rgb.b);
  highp float fExp = ceil(log2(maxComponent));
  vEncoded.rgb = rgb / exp2(fExp);
  vEncoded.a = (fExp + 128.0) / 255.0;
  return vEncoded;
}

highp vec3 decodeRGBE8(highp vec4 rgbe) {
  highp vec3 vDecoded;
  highp float fExp = rgbe.a * 255.0 - 128.0;
  vDecoded = rgbe.rgb * exp2(fExp);
  return vDecoded;
}

highp float vec4ToFloat(highp vec4 vec) {
  highp uvec4 v = uvec4(vec * 255.0);
  highp uint value = (v.a << 24u) | (v.b << 16u) | (v.g << 8u) | (v.r);
  return uintBitsToFloat(value);
}

highp vec4 floatToVec4(highp float f) {
  highp uint value = floatBitsToUint(f);

  highp vec4 v;
  v.r = float(value & 0xFFu) / 255.0;
  v.g = float((value >> 8u) & 0xFFu) / 255.0;
  v.b = float((value >> 16u) & 0xFFu) / 255.0;
  v.a = float((value >> 24u) & 0xFFu) / 255.0;

  return v;
}

highp vec4 packGBuffer(highp vec4 diffuse, highp vec3 normal, highp float roughness, highp float metalness, highp vec3 emissive) {
  highp vec4 gBuffer;

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
Material getMaterial(highp sampler2D gBufferTexture, highp vec2 uv) {
  highp vec4 gBuffer = textureLod(gBufferTexture, uv, 0.0);

  highp vec4 diffuse = floatToVec4(gBuffer.r);
  diffuse = clamp(diffuse, vec4(0.), vec4(ONE_SAFE));
  highp vec3 normal = unpackNormal(gBuffer.g);

  // using float2color instead of unpackVec2 as the latter results in severe
  // precision loss and artifacts on Metal backends
  highp vec3 roughnessMetalness = float2color(gBuffer.b);
  highp float roughness = clamp(roughnessMetalness.r, 0., 1.);
  highp float metalness = clamp(roughnessMetalness.g, 0., 1.);

  highp vec3 emissive = decodeRGBE8(floatToVec4(gBuffer.a));

  return Material(diffuse, normal, roughness, metalness, emissive);
}

Material getMaterial(highp vec2 uv) { return getMaterial(gBufferTexture, uv); }

highp vec3 getNormal(highp sampler2D gBufferTexture, highp vec2 uv) { return unpackNormal(textureLod(gBufferTexture, uv, 0.0).g); }
