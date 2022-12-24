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

float schlick(in vec3 v0, in vec3 v1, in float n1, in float n2) {
    float f0 = (n1 - n2) / (n1 + n2);
    f0 *= f0;
    return max(0., f0 + (1. - f0) * pow(dot(v0, v1), 5.));
}

// source: https://github.com/Domenicobrz/SSR-TAA-in-threejs-/blob/master/Components/ssr.js
vec3 SampleGGX(vec3 wo, vec3 norm, float roughness, vec2 random) {
    float r0 = random.x;
    float r1 = random.y;

    float a = roughness * roughness;

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

float samplePDF(vec3 wi, vec3 wo, vec3 norm, float roughness) {
    vec3 wg = norm;
    vec3 wm = normalize(wo + wi);
    float a = roughness * roughness;
    float a2 = a * a;
    float cosTheta = dot(wg, wm);
    float exp = (a2 - 1.0) * cosTheta * cosTheta + 1.0;
    float D = a2 / (PI * exp * exp);
    return (D * dot(wm, wg)) / (4.0 * dot(wo, wm));
}

float GeometrySchlickGGX(float NdotV, float roughness) {
    float r = (roughness + 1.0);
    float k = (r * r) / 8.0;

    float num = NdotV;
    float denom = NdotV * (1.0 - k) + k;

    return num / denom;
}

float GeometrySmith(vec3 N, vec3 V, vec3 L, float roughness) {
    float a = roughness * roughness;
    float nv = dot(N, V);
    return (2.0 * nv) / (nv + sqrt(a * a + (1.0 - a * a) * nv * nv));

    // float NdotV = max(dot(N, V), 0.0);
    // float NdotL = max(dot(N, L), 0.0);
    // float ggx2  = GeometrySchlickGGX(NdotV, roughness);
    // float ggx1  = GeometrySchlickGGX(NdotL, roughness);

    // return ggx1 * ggx2;
}

vec3 fresnelSchlick(float cosTheta, vec3 F0) {
    return F0 + (1.0 - F0) * pow(max(1.0 - cosTheta, 0.0), 5.0);
}

float DistributionGGX(vec3 N, vec3 H, float roughness) {
    vec3 m = H;
    float a = roughness * roughness;
    float nm2 = pow(dot(N, H), 2.0);
    return (a * a) / (PI * pow(nm2 * (a * a - 1.0) + 1.0, 2.0));
    // float a      = roughness*roughness;
    // float a2     = a*a;
    // float NdotH  = max(dot(N, H), 0.0);
    // float NdotH2 = NdotH*NdotH;

    // float num   = a2;
    // float denom = (NdotH2 * (a2 - 1.0) + 1.0);
    // denom = PI * denom * denom;

    // return num / denom;
}
// http://graphicrants.blogspot.com/2013/08/specular-brdf-reference.html
vec3 EvalBRDF(vec3 wi, vec3 wo, vec3 n, float roughness, vec3 F0) {
    vec3 wm = normalize(wo + wi);
    if (/* (wi.y <= 0.0) || */ dot(wi, wm) <= 0.0) {
        return vec3(0.0);
    }
    vec3 F = fresnelSchlick(max(dot(wi, n), 0.0), F0);
    float NDF = DistributionGGX(n, wm, roughness);
    float G = GeometrySmith(n, wo, wi, roughness);
    // vec3 numerator    = NDF * G * F;
    // float denominator = 4.0 * max(dot(n, wo), 0.0) * max(dot(n, wi), 0.0);
    // vec3 specular     = numerator / max(denominator, 0.001);

    // I removed an additional multiplication dot(wi, n) from this line
    // so that I could also remove the initial multiplication for cos theta at the first bounce
    // took the idea from here: http://cwyman.org/code/dxrTutors/tutors/Tutor14/tutorial14.md.html (step 4)
    vec3 specular = (F * NDF * G) / (4.0 * dot(n, wo));
    return F0 * specular;
    // return specular;
    // // from filament
    // vec3 F    = F_Schlick(max(dot(wm, wo), 0.0), F0);
    // float NDF = DistributionGGXFilament(n, wm, roughness);
    // float G   = V_SmithGGXCorrelatedFast(n, wo, wi, roughness);
    // // specular BRDF
    // vec3 Fr = (NDF * G) * F;
    // return Fr;
}

vec3 F_Schlick(vec3 f0, float theta) {
    return f0 + (1. - f0) * pow(1.0 - theta, 5.);
}

float F_Schlick(float f0, float f90, float theta) {
    return f0 + (f90 - f0) * pow(1.0 - theta, 5.0);
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

    vec3 spec = D * F * G / (4. * NoL * NoV);

    return spec;
}