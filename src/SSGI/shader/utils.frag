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
float getViewZ(const in float depth) {
#ifdef PERSPECTIVE_CAMERA
    return perspectiveDepthToViewZ(depth, cameraNear, cameraFar);
#else
    return orthographicDepthToViewZ(depth, cameraNear, cameraFar);
#endif
}

vec2 viewSpaceToScreenSpace(vec3 position) {
    vec4 projectedCoord = projectionMatrix * vec4(position, 1.0);
    projectedCoord.xy /= projectedCoord.w;
    // [-1, 1] --> [0, 1] (NDC to screen position)
    projectedCoord.xy = projectedCoord.xy * 0.5 + 0.5;

    return projectedCoord.xy;
}

vec2 worldSpaceToScreenSpace(vec3 worldPos) {
    vec4 vsPos = vec4(worldPos, 1.0) * cameraMatrixWorld;

    return viewSpaceToScreenSpace(vsPos.xyz);
}

#ifdef BOX_PROJECTED_ENV_MAP
uniform vec3 envMapSize;
uniform vec3 envMapPosition;

vec3 parallaxCorrectNormal(vec3 v, vec3 cubeSize, vec3 cubePos, vec3 worldPosition) {
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

// source: https://github.com/blender/blender/blob/594f47ecd2d5367ca936cf6fc6ec8168c2b360d0/source/blender/gpu/shaders/material/gpu_shader_material_fresnel.glsl
float fresnel_dielectric_cos(float cosi, float eta) {
    /* compute fresnel reflectance without explicitly computing
     * the refracted direction */
    float c = abs(cosi);
    float g = eta * eta - 1.0 + c * c;
    float result;

    if (g > 0.0) {
        g = sqrt(g);
        float A = (g - c) / (g + c);
        float B = (c * (g + c) - 1.0) / (c * (g - c) + 1.0);
        result = 0.5 * A * A * (1.0 + B * B);
    } else {
        result = 1.0; /* TIR (no refracted component) */
    }

    return result;
}

// source: https://github.com/blender/blender/blob/594f47ecd2d5367ca936cf6fc6ec8168c2b360d0/source/blender/gpu/shaders/material/gpu_shader_material_fresnel.glsl
float fresnel_dielectric(vec3 Incoming, vec3 Normal, float eta) {
    /* compute fresnel reflectance without explicitly computing
     * the refracted direction */

    float cosine = dot(Incoming, Normal);
    return min(1.0, 5.0 * fresnel_dielectric_cos(cosine, eta));
}

#define M_PI 3.1415926535897932384626433832795

// ray sampling x and z are swapped to align with expected background view
vec2 equirectDirectionToUv(vec3 direction) {
    // from Spherical.setFromCartesianCoords
    vec2 uv = vec2(atan(direction.z, direction.x), acos(direction.y));
    uv /= vec2(2.0 * M_PI, M_PI);
    // apply adjustments to get values in range [0, 1] and y right side up

    uv.x += 0.5;
    uv.y = 1.0 - uv.y;

    return uv;
}

vec3 sampleEquirectEnvMapColor(vec3 direction, sampler2D map, float lod) {
    return textureLod(map, equirectDirectionToUv(direction), lod).rgb;
}

mat3 getBasisFromNormal(vec3 normal) {
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

// source: https://github.com/CesiumGS/cesium/blob/main/Source/Shaders/Builtin/Functions/luminance.glsl
float czm_luminance(vec3 rgb) {
    // Algorithm from Chapter 10 of Graphics Shaders.
    const vec3 W = vec3(0.2125, 0.7154, 0.0721);
    return dot(rgb, W);
}

// from: https://github.com/gkjohnson/three-gpu-pathtracer/blob/5c74583ce4e246b5a582cc8fe974051064978207/src/shader/shaderUtils.js
// https://www.shadertoy.com/view/wltcRS
uvec4 s0;
void rng_initialize(vec2 p, int frame) {
    // white noise seed
    s0 = uvec4(p, uint(frame), uint(p.x) + uint(p.y));
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

// returns [ 0, 1 ]
float rand() {
    pcg4d(s0);
    return float(s0.x) / float(0xffffffffu);
}

vec2 rand2() {
    pcg4d(s0);
    return vec2(s0.xy) / float(0xffffffffu);
}

#define EPSILON FLOAT_EPSILON
#define PI      M_PI

float schlick(in vec3 v0, in vec3 v1, in float n1, in float n2) {
    float f0 = (n1 - n2) / (n1 + n2);
    f0 *= f0;
    return max(0., f0 + (1. - f0) * pow(dot(v0, v1), 5.));
}

vec3 F_Schlick(vec3 f0, float theta) {
    return f0 + (1. - f0) * pow(1.0 - theta, 5.);
}

float F_Schlick(float f0, float f90, float theta) {
    return f0 + (f90 - f0) * pow(1.0 - theta, 5.0);
}

vec3 FresnelReflectAmount(float n1, float n2, vec3 normal, vec3 incident, vec3 f0, vec3 f90) {
    // Schlick aproximation
    float r0 = (n1 - n2) / (n1 + n2);
    r0 *= r0;
    float cosX = -dot(normal, incident);
    if (n1 > n2) {
        float n = n1 / n2;
        float sinT2 = n * n * (1.0 - cosX * cosX);
        // Total internal reflection
        if (sinT2 > 1.0)
            return f90;
        cosX = sqrt(1.0 - sinT2);
    }
    float x = 1.0 - cosX;
    float ret = r0 + (1.0 - r0) * x * x * x * x * x;

    // adjust reflect multiplier for object reflectivity
    return mix(f0, f90, ret);
}

float D_GTR(float roughness, float NoH, float k) {
    float a2 = pow(roughness, 2.);
    return a2 / (PI * pow((NoH * NoH) * (a2 * a2 - 1.) + 1., k));
}

float SmithG(float NDotV, float alphaG) {
    float a = alphaG * alphaG;
    float b = NDotV * NDotV;
    return (2.0 * NDotV) / (NDotV + sqrt(a + b - a * b));
}

float GGXVNDFPdf(float NoH, float NoV, float roughness) {
    float D = D_GTR(roughness, NoH, 2.);
    float G1 = SmithG(NoV, roughness * roughness);
    return (D * G1) / max(0.00001, 4.0f * NoV);
}

float GeometryTerm(float NoL, float NoV, float roughness) {
    float a2 = roughness * roughness;
    float G1 = SmithG(NoV, a2);
    float G2 = SmithG(NoL, a2);
    return G1 * G2;
}

float evalDisneyDiffuse(float NoL, float NoV, float LoH, float roughness, float metalness) {
    float FD90 = 0.5 + 2. * roughness * pow(LoH, 2.);
    float a = F_Schlick(1., FD90, NoL);
    float b = F_Schlick(1., FD90, NoV);

    return (a * b / PI) * (1. - metalness);
}

vec3 evalDisneySpecular(float r, vec3 F, float NoH, float NoV, float NoL) {
    float roughness = pow(r, 2.);
    float D = D_GTR(roughness, NoH, 2.);
    float G = GeometryTerm(NoL, NoV, pow(0.5 + r * .5, 2.));

    vec3 spec = vec3(D * G / (4. * NoL * NoV));

    return spec;
}

vec3 SampleGGXVNDF(vec3 V, float ax, float ay, float r1, float r2) {
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

void Onb(in vec3 N, inout vec3 T, inout vec3 B) {
    vec3 up = abs(N.z) < 0.9999999 ? vec3(0, 0, 1) : vec3(1, 0, 0);
    T = normalize(cross(up, N));
    B = cross(N, T);
}

vec3 ToLocal(vec3 X, vec3 Y, vec3 Z, vec3 V) {
    return vec3(dot(V, X), dot(V, Y), dot(V, Z));
}

vec3 ToWorld(vec3 X, vec3 Y, vec3 Z, vec3 V) {
    return V.x * X + V.y * Y + V.z * Z;
}

// source: https://www.shadertoy.com/view/cll3R4
vec3 cosineSampleHemisphere(vec3 n, vec2 u) {
    float r = sqrt(u.x);
    float theta = 2.0 * PI * u.y;

    vec3 b = normalize(cross(n, vec3(0.0, 1.0, 1.0)));
    vec3 t = cross(b, n);

    return normalize(r * sin(theta) * b + sqrt(1.0 - u.x) * n + r * cos(theta) * t);
}