// source: https://github.com/mrdoob/three.js/blob/dev/examples/js/shaders/SSAOShader.js
vec3 getViewPosition(const float depth) {
    float clipW = projectionMatrix[2][3] * depth + projectionMatrix[3][3];
    vec4 clipPosition = vec4((vec3(vUv, depth) - 0.5) * 2.0, 1.0);
    clipPosition *= clipW;
    return (inverseProjectionMatrix * clipPosition).xyz;
}

// source: https://github.com/mrdoob/three.js/blob/342946c8392639028da439b6dc0597e58209c696/examples/js/shaders/SAOShader.js#L123
float getViewZ(const in float depth) {
#ifdef PERSPECTIVE_CAMERA
    return perspectiveDepthToViewZ(depth, cameraNear, cameraFar);
#else
    return orthographicDepthToViewZ(depth, cameraNear, cameraFar);
#endif
}

// credits for transforming screen position to world position: https://discourse.threejs.org/t/reconstruct-world-position-in-screen-space-from-depth-buffer/5532/2
vec3 screenSpaceToWorldSpace(const vec2 uv, const float depth) {
    vec4 ndc = vec4(
        (uv.x - 0.5) * 2.0,
        (uv.y - 0.5) * 2.0,
        (depth - 0.5) * 2.0,
        1.0);

    vec4 clip = inverseProjectionMatrix * ndc;
    vec4 view = cameraMatrixWorld * (clip / clip.w);

    return view.xyz;
}

vec2 viewSpaceToScreenSpace(vec3 position) {
    vec4 projectedCoord = projectionMatrix * vec4(position, 1.0);
    projectedCoord.xy /= projectedCoord.w;
    // [-1, 1] --> [0, 1] (NDC to screen position)
    projectedCoord.xy = projectedCoord.xy * 0.5 + 0.5;

    return projectedCoord.xy;
}

// vec2 worldSpaceToScreenSpace(vec3 worldPos){
//     vec4 ssPos = projectionMatrix * inverse(cameraMatrixWorld) * vec4(worldPos, 1.0);
//     ssPos.xy /= ssPos.w;
//     ssPos.xy = ssPos.xy * 0.5 + 0.5;

//     return ssPos.xy;
// }

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

vec3 fresnelSchlick(float cosTheta, vec3 F0) {
    return F0 + (1.0 - F0) * pow(1.0 - cosTheta, 5.0);
}

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

// Shlick's approximation of the Fresnel factor.
vec3 fresnelSchlick(vec3 F0, float cosTheta) {
    return F0 + (vec3(1.0) - F0) * pow(1.0 - cosTheta, 5.0);
}

#define EPSILON FLOAT_EPSILON
#define PI      M_PI

// An acos with input values bound to the range [-1, 1].
float acosSafe(float x) {
    return acos(clamp(x, -1.0, 1.0));
}

// Below are PDF and related functions for use in a Monte Carlo path tracer
// as specified in Appendix B of the following paper
// See equation (34) from reference [0]
float ggxLamda(float theta, float roughness) {
    float tanTheta = tan(theta);
    float tanTheta2 = tanTheta * tanTheta;
    float alpha2 = roughness * roughness;
    float numerator = -1.0 + sqrt(1.0 + alpha2 * tanTheta2);
    return numerator / 2.0;
}
// See equation (34) from reference [0]
float ggxShadowMaskG1(float theta, float roughness) {
    return 1.0 / (1.0 + ggxLamda(theta, roughness));
}
// See equation (125) from reference [4]
float ggxShadowMaskG2(vec3 wi, vec3 wo, float roughness) {
    float incidentTheta = acos(wi.z);
    float scatterTheta = acos(wo.z);
    return 1.0 / (1.0 + ggxLamda(incidentTheta, roughness) + ggxLamda(scatterTheta, roughness));
}
// See equation (33) from reference [0]
float ggxDistribution(vec3 halfVector, float roughness) {
    float a2 = roughness * roughness;
    a2 = max(EPSILON, a2);
    float cosTheta = halfVector.z;
    float cosTheta4 = pow(cosTheta, 4.0);
    if (cosTheta == 0.0) return 0.0;
    float theta = acosSafe(halfVector.z);
    float tanTheta = tan(theta);
    float tanTheta2 = pow(tanTheta, 2.0);
    float denom = PI * cosTheta4 * pow(a2 + tanTheta2, 2.0);
    return (a2 / denom);
}

// See equation (3) from reference [2]
float ggxPDF(vec3 wi, vec3 halfVector, float roughness) {
    float incidentTheta = acos(wi.z);
    float D = ggxDistribution(halfVector, roughness);
    float G1 = ggxShadowMaskG1(incidentTheta, roughness);
    return D * G1 * max(0.0, dot(wi, halfVector)) / wi.z;
}

vec3 getHalfVector(vec3 a, vec3 b) {
    return normalize(a + b);
}

float specularPDF(vec3 wo, vec3 wi, float roughness) {
    // See 14.1.1 Microfacet BxDFs in https://www.pbr-book.org/
    float filteredRoughness = roughness;
    vec3 halfVector = getHalfVector(wi, wo);
    float incidentTheta = acos(wo.z);
    float D = ggxDistribution(halfVector, filteredRoughness);
    float G1 = ggxShadowMaskG1(incidentTheta, filteredRoughness);
    float ggxPdf = D * G1 * max(0.0, abs(dot(wo, halfVector))) / abs(wo.z);
    return ggxPdf / (4.0 * dot(wo, halfVector));
}

float diffusePDF(vec3 wo, vec3 wi) {
    // https://raytracing.github.io/books/RayTracingTheRestOfYourLife.html#lightscattering/thescatteringpdf
    float cosValue = dot(wo, wi);
    return cosValue / PI;
}

vec3 SampleLambert(vec3 viewNormal, vec2 random, out float pdf) {
    float sqrtR0 = sqrt(random.x);

    float x = sqrtR0 * cos(2. * M_PI * random.y);
    float y = sqrtR0 * sin(2. * M_PI * random.y);
    float z = sqrt(1. - random.x);

    vec3 hemisphereVector = vec3(x, y, z);

    mat3 normalBasis = getBasisFromNormal(viewNormal);

    pdf = z * M_PI;
    if (pdf < 0.25) pdf = 0.25;

    return normalize(normalBasis * hemisphereVector);
}

// source: https://github.com/Domenicobrz/SSR-TAA-in-threejs-/blob/master/Components/ssr.js
vec3 SampleGGX(vec3 wo, vec3 norm, float roughness, vec2 random, out float pdf) {
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

    // pdf = specularPDF(wi, norm, roughness);

    return wi;
}