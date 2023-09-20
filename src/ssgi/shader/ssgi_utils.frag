#define PI M_PI

#define luminance(a) dot(vec3(0.2125, 0.7154, 0.0721), a)

// source:
// https://github.com/mrdoob/three.js/blob/342946c8392639028da439b6dc0597e58209c696/examples/js/shaders/SAOShader.js#L123
float getViewZ(const in float depth) {
#ifdef PERSPECTIVE_CAMERA
  return nearMulFar / (farMinusNear * depth - cameraFar);
#else
  return depth * nearMinusFar - cameraNear;
#endif
}

// source:
// https://github.com/mrdoob/three.js/blob/dev/examples/js/shaders/SSAOShader.js
vec3 getViewPosition(float viewZ) {
  float clipW = projectionMatrix[2][3] * viewZ + projectionMatrix[3][3];
  vec4 clipPosition = vec4((vec3(vUv, viewZ) - 0.5) * 2.0, 1.0);
  clipPosition *= clipW;
  vec3 p = (projectionMatrixInverse * clipPosition).xyz;
  p.z = viewZ;
  return p;
}

vec2 viewSpaceToScreenSpace(const vec3 position) {
  vec4 projectedCoord = projectionMatrix * vec4(position, 1.0);
  projectedCoord.xy /= projectedCoord.w;
  // [-1, 1] --> [0, 1] (NDC to screen position)
  projectedCoord.xy = projectedCoord.xy * 0.5 + 0.5;

  return projectedCoord.xy;
}

vec3 worldSpaceToViewSpace(vec3 worldPosition) {
  vec4 viewPosition = viewMatrix * vec4(worldPosition, 1.0);
  return viewPosition.xyz / viewPosition.w;
}

#ifdef BOX_PROJECTED_ENV_MAP
uniform vec3 envMapSize;
uniform vec3 envMapPosition;

vec3 parallaxCorrectNormal(const vec3 v, const vec3 cubeSize, const vec3 cubePos, const vec3 worldPosition) {
  vec3 nDir = normalize(v);
  vec3 rbmax = (.5 * cubeSize + cubePos - worldPosition) / nDir;
  vec3 rbmin = (-.5 * cubeSize + cubePos - worldPosition) / nDir;
  vec3 rbminmax;
  rbminmax.x = (nDir.x > 0.) ? rbmax.x : rbmin.x;
  rbminmax.y = (nDir.y > 0.) ? rbmax.y : rbmin.y;
  rbminmax.z = (nDir.z > 0.) ? rbmax.z : rbmin.z;
  float correction = min(min(rbminmax.x, rbminmax.y), rbminmax.z);
  vec3 boxIntersection = worldPosition + nDir * correction;

  return boxIntersection - cubePos;
}
#endif

#define M_PI 3.1415926535897932384626433832795

// source:
// https://github.com/gkjohnson/three-gpu-pathtracer/blob/4de53ebc08dffdb21dbb14beb5c9953b600978cc/src/shader/shaderUtils.js#L215
// ray sampling x and z are swapped to align with expected background view
vec2 equirectDirectionToUv(const vec3 direction) {
  // from Spherical.setFromCartesianCoords
  vec2 uv = vec2(atan(direction.z, direction.x), acos(direction.y));
  uv /= vec2(2.0 * M_PI, M_PI);
  // apply adjustments to get values in range [0, 1] and y right side up

  uv.x += 0.5;
  uv.y = 1.0 - uv.y;

  return uv;
}

// source: https://github.com/gkjohnson/three-gpu-pathtracer
vec3 equirectUvToDirection(vec2 uv) {
  // undo above adjustments
  uv.x -= 0.5;
  uv.y = 1.0 - uv.y;
  // from Vector3.setFromSphericalCoords
  float theta = uv.x * 2.0 * PI;
  float phi = uv.y * PI;
  float sinPhi = sin(phi);
  return vec3(sinPhi * cos(theta), cos(phi), sinPhi * sin(theta));
}

// source:
// https://github.com/gkjohnson/three-gpu-pathtracer/blob/3340cc19c796a01abe0ec121930154ec3301e4f2/src/shader/shaderEnvMapSampling.js#L3
vec3 sampleEquirectEnvMapColor(const vec3 direction, const sampler2D map, const float lod) {
  return textureLod(map, equirectDirectionToUv(direction), lod).rgb;
}

// source of the following functions: https://www.shadertoy.com/view/cll3R4

mat3 getBasisFromNormal(const vec3 normal) {
  vec3 other;
  if (abs(normal.x) > 0.5) {
    other = vec3(0.0, 1.0, 0.0);
  } else {
    other = vec3(1.0, 0.0, 0.0);
  }
  vec3 ortho = normalize(cross(normal, other));
  vec3 ortho2 = normalize(cross(normal, ortho));
  return mat3(ortho2, ortho, normal);
}

vec3 F_Schlick(const vec3 f0, const float theta) { return f0 + (1. - f0) * pow(1.0 - theta, 5.); }

float F_Schlick(const float f0, const float f90, const float theta) { return f0 + (f90 - f0) * pow(1.0 - theta, 5.0); }

float D_GTR(const float roughness, const float NoH, const float k) {
  float a2 = pow(roughness, 2.);
  return a2 / (PI * pow((NoH * NoH) * (a2 * a2 - 1.) + 1., k));
}

float SmithG(const float NDotV, const float alphaG) {
  float a = alphaG * alphaG;
  float b = NDotV * NDotV;
  return (2.0 * NDotV) / (NDotV + sqrt(a + b - a * b));
}

float GGXVNDFPdf(const float NoH, const float NoV, const float roughness) {
  float D = D_GTR(roughness, NoH, 2.);
  float G1 = SmithG(NoV, roughness * roughness);
  return (D * G1) / max(0.00001, 4.0 * NoV);
}

float GeometryTerm(const float NoL, const float NoV, const float roughness) {
  float a2 = roughness * roughness;
  float G1 = SmithG(NoV, a2);
  float G2 = SmithG(NoL, a2);
  return G1 * G2;
}

float evalDisneyDiffuse(const float NoL, const float NoV, const float LoH, const float roughness, const float metalness) {
  float FD90 = 0.5 + 2. * roughness * pow(LoH, 2.);
  float a = F_Schlick(1., FD90, NoL);
  float b = F_Schlick(1., FD90, NoV);

  return (a * b / PI) * (1. - metalness);
}

vec3 evalDisneySpecular(const float roughness, const float NoH, const float NoV, const float NoL) {
  float D = D_GTR(roughness, NoH, 2.);
  float G = GeometryTerm(NoL, NoV, pow(0.5 + roughness * .5, 2.));

  vec3 spec = vec3(D * G / (4. * NoL * NoV));

  return spec;
}

vec3 SampleGGXVNDF(const vec3 V, const float ax, const float ay, const float r1, const float r2) {
  vec3 Vh = normalize(vec3(ax * V.x, ay * V.y, V.z));

  float lensq = Vh.x * Vh.x + Vh.y * Vh.y;
  vec3 T1 = lensq > 0. ? vec3(-Vh.y, Vh.x, 0.) * inversesqrt(lensq) : vec3(1., 0., 0.);
  vec3 T2 = cross(Vh, T1);

  float r = sqrt(r1);
  float phi = 2.0 * PI * r2;
  float t1 = r * cos(phi);
  float t2 = r * sin(phi);
  float s = 0.5 * (1.0 + Vh.z);
  t2 = (1.0 - s) * sqrt(1.0 - t1 * t1) + s * t2;

  vec3 Nh = t1 * T1 + t2 * T2 + sqrt(max(0.0, 1.0 - t1 * t1 - t2 * t2)) * Vh;

  return normalize(vec3(ax * Nh.x, ay * Nh.y, max(0.0, Nh.z)));
}

void Onb(const vec3 N, inout vec3 T, inout vec3 B) {
  vec3 up = abs(N.z) < 0.9999999 ? vec3(0, 0, 1) : vec3(1, 0, 0);
  T = normalize(cross(up, N));
  B = cross(N, T);
}

vec3 ToLocal(const vec3 X, const vec3 Y, const vec3 Z, const vec3 V) { return vec3(dot(V, X), dot(V, Y), dot(V, Z)); }

vec3 ToWorld(const vec3 X, const vec3 Y, const vec3 Z, const vec3 V) { return V.x * X + V.y * Y + V.z * Z; }

// source: https://www.shadertoy.com/view/cll3R4
vec3 cosineSampleHemisphere(const vec3 n, const vec2 u) {
  float r = sqrt(u.x);
  float theta = 2.0 * PI * u.y;

  vec3 b = normalize(cross(n, vec3(0.0, 1.0, 1.0)));
  vec3 t = cross(b, n);

  return normalize(r * sin(theta) * b + sqrt(1.0 - u.x) * n + r * cos(theta) * t);
}

// end: functions

// source: https://github.com/gkjohnson/three-gpu-pathtracer
float equirectDirectionPdf(vec3 direction) {
  vec2 uv = equirectDirectionToUv(direction);
  float theta = uv.y * PI;
  float sinTheta = sin(theta);
  if (sinTheta == 0.0) {
    return 0.0;
  }

  return 1.0 / (2.0 * PI * PI * sinTheta);
}

// for whatever reason, using names like "random" or "noise" for the blueNoise
// param results in shader errors, e.g. "_urandom is not defined"
// source: https://github.com/gkjohnson/three-gpu-pathtracer
float sampleEquirectProbability(EquirectHdrInfo info, vec2 blueNoise, out vec3 direction) {
  // sample env map cdf
  float v = textureLod(info.marginalWeights, vec2(blueNoise.x, 0.0), 0.).x;
  float u = textureLod(info.conditionalWeights, vec2(blueNoise.y, v), 0.).x;
  vec2 uv = vec2(u, v);

  vec3 derivedDirection = equirectUvToDirection(uv);
  direction = derivedDirection;
  vec3 color = texture(info.map, uv).rgb;

  float totalSum = info.totalSumWhole + info.totalSumDecimal;
  float lum = luminance(color);
  float pdf = lum / totalSum;

  return info.size.x * info.size.y * pdf;
}

float misHeuristic(float a, float b) {
  float aa = a * a;
  float bb = b * b;
  return aa / (aa + bb);
}

// this function takes a normal and a direction as input and returns a new
// direction that is aligned to the normal
vec3 alignToNormal(const vec3 normal, const vec3 direction) {
  vec3 tangent;
  vec3 bitangent;
  Onb(normal, tangent, bitangent);

  vec3 localDir = ToLocal(tangent, bitangent, normal, direction);
  vec3 localDirAligned = vec3(localDir.x, localDir.y, abs(localDir.z));
  vec3 alignedDir = ToWorld(tangent, bitangent, normal, localDirAligned);

  return alignedDir;
}

// source:
// http://rodolphe-vaillant.fr/entry/118/curvature-of-a-distance-field-implicit-surface
float getFlatness(vec3 g, vec3 rp) {
  vec3 gw = fwidth(g);
  vec3 pw = fwidth(rp);

  float wfcurvature = length(gw) / length(pw);
  wfcurvature = smoothstep(0.0, 30., wfcurvature);

  return clamp(wfcurvature, 0., 1.);
}