uniform highp sampler2D gBufferTexture;

struct Material {
  highp vec4 diffuse;
  highp vec3 normal;
  highp float roughness;
  highp float metalness;
  highp vec3 emissive;
};

highp float color2float(in highp vec3 c) {
  c *= 255.0;
  c = floor(c); // without this value could be shifted for some intervals

  return c.r * 256.0 * 256.0 + c.g * 256.0 + c.b - 8388608.0;
}

// values out of <-8388608;8388608> are stored as min/max values
highp vec3 float2color(in highp float val) {
  val += 8388608.0; // this makes values signed
  if (val < 0.0) {
    return vec3(0.0);
  }

  if (val > 16777216.0) {
    return vec3(1.0);
  }

  highp vec3 c = vec3(0.0);
  c.b = mod(val, 256.0);
  val = floor(val / 256.0);
  c.g = mod(val, 256.0);
  val = floor(val / 256.0);
  c.r = mod(val, 256.0);
  return c / 255.0;
}

// source:
// https://knarkowicz.wordpress.com/2014/04/16/octahedron-normal-vector-encoding/
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

// source:
// https://knarkowicz.wordpress.com/2014/04/16/octahedron-normal-vector-encoding/
highp vec3 decodeOctWrap(highp vec2 f) {
  f = f * 2.0 - 1.0;

  // https://twitter.com/Stubbesaurus/status/937994790553227264
  highp vec3 n = vec3(f.x, f.y, 1.0 - abs(f.x) - abs(f.y));
  highp float t = max(-n.z, 0.0);
  n.x += n.x >= 0.0 ? -t : t;
  n.y += n.y >= 0.0 ? -t : t;
  return normalize(n);
}

highp float packNormal(highp vec3 normal) {
  return uintBitsToFloat(packHalf2x16(encodeOctWrap(normal)));
}

highp vec3 unpackNormal(highp float packedNormal) {
  return decodeOctWrap(unpackHalf2x16(floatBitsToUint(packedNormal)));
}

highp float packVec2(highp vec2 vec) {
  highp float x = fract(vec.x * 255.0);
  highp float y = fract(vec.y * 255.0);
  return (x * 255.0 + y) / 65535.0;
}

highp vec2 unpackVec2(highp float f) {
  highp float xy = f * 65535.0;
  highp float x = floor(xy / 256.0) / 255.0;
  highp float y = mod(xy, 256.0) / 255.0;
  return vec2(x, y);
}

highp vec4 packTwoVec4(highp vec4 v1, highp vec4 v2) {
  highp vec4 encoded = vec4(0.0);

  encoded.r = uintBitsToFloat(packHalf2x16(v1.rg));
  encoded.g = uintBitsToFloat(packHalf2x16(v1.ba));
  encoded.b = uintBitsToFloat(packHalf2x16(v2.rg));
  encoded.a = uintBitsToFloat(packHalf2x16(v2.ba));

  return encoded;
}

void unpackTwoVec4(highp vec4 encoded, out highp vec4 v1, out highp vec4 v2) {
  v1.rg = unpackHalf2x16(floatBitsToUint(encoded.r));
  v1.ba = unpackHalf2x16(floatBitsToUint(encoded.g));

  v2.rg = unpackHalf2x16(floatBitsToUint(encoded.b));
  v2.ba = unpackHalf2x16(floatBitsToUint(encoded.a));
}

// source:
// https://community.khronos.org/t/addition-of-two-hdr-rgbe-values/55669/2
highp vec4 encodeRGBE8(highp vec3 rgb) {
  highp vec4 vEncoded;
  highp float maxComponent = max(max(rgb.r, rgb.g), rgb.b);
  highp float fExp = ceil(log2(maxComponent));
  vEncoded.rgb = rgb / exp2(fExp);
  vEncoded.a = (fExp + 128.0) / 255.0;
  return vEncoded;
}

// source:
// https://community.khronos.org/t/addition-of-two-hdr-rgbe-values/55669/2
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

highp vec4 packGBuffer(highp vec4 diffuse, highp vec3 normal,
                       highp float roughness, highp float metalness,
                       highp vec3 emissive) {
  highp vec4 gBuffer;

  // clamp diffuse to [0;1[
  // has to be done as otherwise we get blue instead of white on Metal backends
  diffuse = clamp(diffuse, vec4(0.), vec4(0.999999));

  gBuffer.r = vec4ToFloat(diffuse);
  gBuffer.g = packNormal(normal);
  gBuffer.b = vec4ToFloat(vec2(roughness, metalness).xxyy);
  gBuffer.a = vec4ToFloat(encodeRGBE8(emissive));

  return gBuffer;
}

// loading a material from a packed g-buffer
Material getMaterial(sampler2D gBufferTexture, highp vec2 uv) {
  highp vec4 gBuffer = textureLod(gBufferTexture, uv, 0.0);

  highp vec4 diffuse = floatToVec4(gBuffer.r);
  highp vec3 normal = unpackNormal(gBuffer.g);
  highp vec4 roughnessMetalness = floatToVec4(gBuffer.b);
  highp float roughness = roughnessMetalness.r;
  highp float metalness = roughnessMetalness.b;
  highp vec3 emissive = decodeRGBE8(floatToVec4(gBuffer.a));

  return Material(diffuse, normal, roughness, metalness, emissive);
}
