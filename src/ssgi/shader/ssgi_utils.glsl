#define PI           M_PI

#define luminance(a) dot(vec3(0.2125, 0.7154, 0.0721), a)

const float g = 1.6180339887498948482;
const float a1 = 1.0 / g;
const float a2 = 1.0 / (g * g);

// reference: https://extremelearning.com.au/unreasonable-effectiveness-of-quasirandom-sequences/
float r1(float n) {
    // 7th harmonious number
    return fract(1.1127756842787055 + a1 * n);
}
// source: https://iquilezles.org/articles/texture/
vec4 getTexel(const sampler2D tex, vec2 p, const float mip) {
    p = p / invTexSize + 0.5;

    vec2 i = floor(p);
    vec2 f = p - i;
    f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    p = i + f;

    p = (p - 0.5) * invTexSize;
    return textureLod(tex, p, mip);
}

// source: https://github.com/mrdoob/three.js/blob/dev/examples/js/shaders/SSAOShader.js
vec3 getViewPosition(const float depth) {
    float clipW = projectionMatrix[2][3] * depth + projectionMatrix[3][3];
    vec4 clipPosition = vec4((vec3(vUv, depth) - 0.5) * 2.0, 1.0);
    clipPosition *= clipW;
    return (inverseProjectionMatrix * clipPosition).xyz;
}

vec3 screenSpaceToWorldSpace(vec2 uv, float depth, mat4 camMatrixWorld) {
    vec3 viewPos = getViewPosition(depth);

    return vec4(camMatrixWorld * vec4(viewPos, 1.)).xyz;
}

// source: https://github.com/mrdoob/three.js/blob/342946c8392639028da439b6dc0597e58209c696/examples/js/shaders/SAOShader.js#L123
float getViewZ(const float depth) {
#ifdef PERSPECTIVE_CAMERA
    return perspectiveDepthToViewZ(depth, cameraNear, cameraFar);
#else
    return orthographicDepthToViewZ(depth, cameraNear, cameraFar);
#endif
}

vec2 viewSpaceToScreenSpace(const vec3 position) {
    vec4 projectedCoord = projectionMatrix * vec4(position, 1.0);
    projectedCoord.xy /= projectedCoord.w;
    // [-1, 1] --> [0, 1] (NDC to screen position)
    projectedCoord.xy = projectedCoord.xy * 0.5 + 0.5;

    return projectedCoord.xy;
}

vec2 worldSpaceToScreenSpace(const vec3 worldPos) {
    vec4 vsPos = vec4(worldPos, 1.0) * cameraMatrixWorld;

    return viewSpaceToScreenSpace(vsPos.xyz);
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

// source: https://github.com/gkjohnson/three-gpu-pathtracer/blob/4de53ebc08dffdb21dbb14beb5c9953b600978cc/src/shader/shaderUtils.js#L215
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

// source: https://github.com/gkjohnson/three-gpu-pathtracer/blob/3340cc19c796a01abe0ec121930154ec3301e4f2/src/shader/shaderEnvMapSampling.js#L3
vec3 sampleEquirectEnvMapColor(const vec3 direction, const sampler2D map, const float lod) {
    return getTexel(map, equirectDirectionToUv(direction), lod).rgb;
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

vec3 F_Schlick(const vec3 f0, const float theta) {
    return f0 + (1. - f0) * pow(1.0 - theta, 5.);
}

float F_Schlick(const float f0, const float f90, const float theta) {
    return f0 + (f90 - f0) * pow(1.0 - theta, 5.0);
}

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
    return (D * G1) / max(0.00001, 4.0f * NoV);
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

vec3 ToLocal(const vec3 X, const vec3 Y, const vec3 Z, const vec3 V) {
    return vec3(dot(V, X), dot(V, Y), dot(V, Z));
}

vec3 ToWorld(const vec3 X, const vec3 Y, const vec3 Z, const vec3 V) {
    return V.x * X + V.y * Y + V.z * Z;
}

// source: https://www.shadertoy.com/view/cll3R4
vec3 cosineSampleHemisphere(const vec3 n, const vec2 u) {
    float r = sqrt(u.x);
    float theta = 2.0 * PI * u.y;

    vec3 b = normalize(cross(n, vec3(0.0, 1.0, 1.0)));
    vec3 t = cross(b, n);

    return normalize(r * sin(theta) * b + sqrt(1.0 - u.x) * n + r * cos(theta) * t);
}

// end: functions

float equirectDirectionPdf(vec3 direction) {
    vec2 uv = equirectDirectionToUv(direction);
    float theta = uv.y * PI;
    float sinTheta = sin(theta);
    if (sinTheta == 0.0) {
        return 0.0;
    }

    return 1.0 / (2.0 * PI * PI * sinTheta);
}

float sampleEquirectProbability(EquirectHdrInfo info, vec2 r, out vec3 direction) {
    // sample env map cdf
    float v = textureLod(info.marginalWeights, vec2(r.x, 0.0), 0.).x;
    float u = textureLod(info.conditionalWeights, vec2(r.y, v), 0.).x;
    vec2 uv = vec2(u, v);

    vec3 derivedDirection = equirectUvToDirection(uv);
    direction = derivedDirection;
    vec3 color = texture2D(info.map, uv).rgb;

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

// source: https://www.shadertoy.com/view/wltcRS

// internal RNG state
uvec4 s0, s1;
ivec2 pixel;

void rng_initialize(vec2 p, int frame) {
    pixel = ivec2(p);

    // white noise seed
    s0 = uvec4(p, uint(frame), uint(p.x) + uint(p.y));

    // blue noise seed
    s1 = uvec4(frame, frame * 15843, frame * 31 + 4566, frame * 2345 + 58585);
}

// https://www.pcg-random.org/
void pcg4d(inout uvec4 v) {
    v = v * 1664525u + 1013904223u;
    v.x += v.y * v.w;
    v.y += v.z * v.x;
    v.z += v.x * v.y;
    v.w += v.y * v.z;
    v = v ^ (v >> 16u);
    v.x += v.y * v.w;
    v.y += v.z * v.x;
    v.z += v.x * v.y;
    v.w += v.y * v.z;
}

float rand() {
    pcg4d(s0);
    return float(s0.x) / float(0xffffffffu);
}

vec2 rand2() {
    pcg4d(s0);
    return vec2(s0.xy) / float(0xffffffffu);
}

vec3 rand3() {
    pcg4d(s0);
    return vec3(s0.xyz) / float(0xffffffffu);
}

vec4 rand4() {
    pcg4d(s0);
    return vec4(s0) / float(0xffffffffu);
}

// random blue noise sampling pos
ivec2 shift2() {
    pcg4d(s1);
    return (pixel + ivec2(s1.xy % 0x0fffffffu)) % 1024;
}