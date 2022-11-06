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

vec3 SampleLambert(vec3 viewNormal, vec2 random) {
    float sqrtR0 = sqrt(random.x);

    float x = sqrtR0 * cos(2. * M_PI * random.y);
    float y = sqrtR0 * sin(2. * M_PI * random.y);
    float z = sqrt(1. - random.x);

    vec3 hemisphereVector = vec3(x, y, z);

    mat3 normalBasis = getBasisFromNormal(viewNormal);

    return normalize(normalBasis * hemisphereVector);
}

// source: https://github.com/Domenicobrz/SSR-TAA-in-threejs-/blob/master/Components/ssr.js
vec3 SampleGGX(vec3 wo, vec3 norm, float roughness, vec2 random) {
    float r0 = random.x;
    float r1 = random.y;

    float a = roughness * roughness;
    a = max(a, 0.01);

    float a2 = a * a;
    float theta = acos(sqrt((1.0 - r0) / ((a2 - 1.0) * r0 + 1.0)));
    float phi = 2.0 * M_PI * r1;
    float x = sin(theta) * cos(phi);
    float y = cos(theta);
    float z = sin(theta) * sin(phi);
    vec3 wm = normalize(vec3(x, y, z));
    vec3 w = norm;
    if (abs(norm.y) < 0.95) {
        vec3 u = normalize(cross(w, vec3(0.0, 1.0, 0.0)));
        vec3 v = normalize(cross(u, w));
        wm = normalize(wm.y * w + wm.x * u + wm.z * v);
    } else {
        vec3 u = normalize(cross(w, vec3(0.0, 0.0, 1.0)));
        vec3 v = normalize(cross(u, w));
        wm = normalize(wm.y * w + wm.x * u + wm.z * v);
    }
    vec3 wi = reflect(wo, wm);

    return wi;
}