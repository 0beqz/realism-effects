layout(location = 0) out vec4 gDiffuse;
layout(location = 1) out vec4 gSpecular;

varying vec2 vUv;

uniform sampler2D diffuseLightingTexture;
uniform sampler2D specularLightingTexture;
uniform sampler2D depthTexture;
uniform sampler2D normalTexture;
uniform sampler2D momentsTexture;
uniform vec2 invTexSize;
uniform bool horizontal;
uniform float lumaPhiDiffuse;
uniform float lumaPhiSpecular;
uniform float depthPhi;
uniform float normalPhi;
uniform float roughnessPhi;
uniform float curvaturePhi;
uniform float denoiseKernel;
uniform float stepSize;
uniform mat4 _viewMatrix;
uniform mat4 _projectionMatrixInverse;
uniform mat4 projectionMatrix;
uniform mat4 cameraMatrixWorld;
uniform bool isLastIteration;

#include <packing>

#define FLOAT_EPSILON 0.00001
#define M_PI          3.1415926535897932384626433832795
#define PI            M_PI

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

float random(vec2 st) {
    return fract(sin(dot(st.xy,
                         vec2(12.9898, 78.233))) *
                 43758.5453123);
}

vec3 evalDisneySpecular(float roughness, float NoH, float NoV, float NoL) {
    float D = D_GTR(roughness, NoH, 2.);
    float G = GeometryTerm(NoL, NoV, pow(0.5 + roughness * .5, 2.));

    vec3 spec = vec3(D * G / (4. * NoL * NoV));

    return spec;
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

// source: https://github.com/CesiumGS/cesium/blob/main/Source/Shaders/Builtin/Functions/luminance.glsl
float czm_luminance(vec3 rgb) {
    // Algorithm from Chapter 10 of Graphics Shaders.
    const vec3 W = vec3(0.2125, 0.7154, 0.0721);
    return dot(rgb, W);
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

// source: https://github.com/mrdoob/three.js/blob/dev/examples/js/shaders/SSAOShader.js
vec3 getViewPosition(const float depth) {
    float clipW = projectionMatrix[2][3] * depth + projectionMatrix[3][3];
    vec4 clipPosition = vec4((vec3(vUv, depth) - 0.5) * 2.0, 1.0);
    clipPosition *= clipW;
    return (_projectionMatrixInverse * clipPosition).xyz;
}

vec3 F_Schlick(vec3 f0, float theta) {
    return f0 + (1. - f0) * pow(1.0 - theta, 5.);
}

float getCurvature(vec3 normal) {
    vec3 dx = dFdx(normal);
    vec3 dy = dFdy(normal);

    float x = dot(dx, dx);
    float y = dot(dy, dy);

    float curvature = sqrt(x * x + y * y);

    return curvature;
}

vec3 screenSpaceToWorldSpace(const vec2 uv, const float depth, mat4 curMatrixWorld) {
    vec4 ndc = vec4(
        (uv.x - 0.5) * 2.0,
        (uv.y - 0.5) * 2.0,
        (depth - 0.5) * 2.0,
        1.0);

    vec4 clip = _projectionMatrixInverse * ndc;
    vec4 view = curMatrixWorld * (clip / clip.w);

    return view.xyz;
}

float distToPlane(vec3 worldPos, vec3 neighborWorldPos, vec3 worldNormal) {
    vec3 toCurrent = worldPos - neighborWorldPos;
    float distToPlane = abs(dot(toCurrent, worldNormal));

    return distToPlane;
}

void tap(vec2 neighborVec, vec2 pixelStepOffset, float depth, vec3 normal, float curvature, float roughness, vec3 worldPos, float lumaDiffuse, float lumaSpecular, float colorPhiDiffuse,
         float colorPhiSpecular,
         inout vec3 diffuseLightingColor, inout vec3 specularLightingColor, inout float totalWeightDiffuse, inout float sumVarianceDiffuse,
         inout float totalWeightSpecular, inout float sumVarianceSpecular) {
    vec2 neighborUv = vUv + neighborVec * pixelStepOffset;

    vec4 neighborDepthTexel = textureLod(depthTexture, neighborUv, 0.);
    float neighborDepth = unpackRGBAToDepth(neighborDepthTexel);
    vec3 neighborWorldPos = screenSpaceToWorldSpace(neighborUv, neighborDepth, cameraMatrixWorld);

    float depthDiff = (1. - distToPlane(worldPos, neighborWorldPos, normal));

    float depthSimilarity = max(depthDiff / depthPhi, 0.);

    vec4 neighborNormalTexel = textureLod(normalTexture, neighborUv, 0.);
    vec3 neighborNormal = unpackRGBToNormal(neighborNormalTexel.rgb);
    neighborNormal = normalize((vec4(neighborNormal, 1.0) * _viewMatrix).xyz);
    float neighborRoughness = neighborNormalTexel.a;

    float normalDiff = dot(neighborNormal, normal);
    float normalSimilarity = pow(max(0., normalDiff), normalPhi);

    vec4 diffuseNeighborInputTexel = textureLod(diffuseLightingTexture, neighborUv, 0.);
    vec3 diffuseNeighborColor = diffuseNeighborInputTexel.rgb;

    vec4 specularNeighborInputTexel = textureLod(specularLightingTexture, neighborUv, 0.);
    vec3 specularNeighborColor = specularNeighborInputTexel.rgb;

    float neighborLumaDiffuse = czm_luminance(diffuseNeighborColor);
    float neighborLumaSpecular = czm_luminance(specularNeighborColor);
    float neighborCurvature = getCurvature(neighborNormal);

    float lumaDiffDiffuse = abs(lumaDiffuse - neighborLumaDiffuse);
    float lumaDiffSpecular = abs(lumaSpecular - neighborLumaSpecular);

    float roughnessDiff = abs(roughness - neighborRoughness);
    float curvatureDiff = abs(curvature - neighborCurvature);

    float lumaSimilarityDiffuse = max(1.0 - lumaDiffDiffuse / colorPhiDiffuse, 0.0);
    float lumaSimilaritySpecular = max(1.0 - lumaDiffSpecular / colorPhiSpecular, 0.0);

    float roughnessSimilarity = exp(-roughnessDiff * roughnessPhi);
    float curvatureSimilarity = exp(-curvatureDiff * curvaturePhi);

    float basicWeight = normalSimilarity * depthSimilarity * roughnessSimilarity * curvatureSimilarity;
    float weightDiffuse = basicWeight * lumaSimilarityDiffuse;
    float weightSpecular = basicWeight * lumaSimilaritySpecular;

    if (weightDiffuse > 1.) weightDiffuse = 1.;
    if (weightSpecular > 1.) weightSpecular = 1.;

    diffuseLightingColor += diffuseNeighborColor * weightDiffuse;
    specularLightingColor += specularNeighborColor * weightSpecular;

    totalWeightDiffuse += weightDiffuse;
    totalWeightSpecular += weightSpecular;

#ifdef USE_MOMENT
    float neighborVarianceDiffuse, neighborVarianceSpecular;
    if (horizontal && stepSize == 1.) {
        neighborVarianceDiffuse = diffuseNeighborInputTexel.a;
        neighborVarianceSpecular = specularNeighborInputTexel.a;
    } else {
        vec4 neighborMoment = textureLod(momentsTexture, neighborUv, 0.);

        neighborVarianceDiffuse = max(0.0, neighborMoment.g - neighborMoment.r * neighborMoment.r);
        neighborVarianceSpecular = max(0.0, neighborMoment.a - neighborMoment.b * neighborMoment.b);
    }

    sumVarianceDiffuse += weightDiffuse * weightDiffuse * neighborVarianceDiffuse;
    sumVarianceSpecular += weightSpecular * weightSpecular * neighborVarianceSpecular;
#endif
}

void main() {
    vec4 depthTexel = textureLod(depthTexture, vUv, 0.);
    vec4 diffuseLightingTexel = textureLod(diffuseLightingTexture, vUv, 0.);
    vec4 specularLightingTexel = textureLod(specularLightingTexture, vUv, 0.);

    // skip background
    if (dot(depthTexel.rgb, depthTexel.rgb) == 0.) {
        gDiffuse = gSpecular = vec4(diffuseLightingTexel.rgb, 0.);
        return;
    }

    vec4 normalTexel = textureLod(normalTexture, vUv, 0.);
    vec3 viewNormal = unpackRGBToNormal(normalTexel.rgb);
    vec3 normal = normalize((vec4(viewNormal, 1.0) * _viewMatrix).xyz);
    float curvature = getCurvature(normal);

    vec3 diffuseLightingColor = diffuseLightingTexel.rgb;
    vec3 specularLightingColor = specularLightingTexel.rgb;

    float depth = unpackRGBAToDepth(depthTexel);
    float lumaDiffuse = czm_luminance(diffuseLightingColor);
    float lumaSpecular = czm_luminance(specularLightingColor);
    vec2 pixelStepOffset = invTexSize * stepSize;

    vec3 worldPos = screenSpaceToWorldSpace(vUv, depth, cameraMatrixWorld);

    float roughness = normalTexel.a;

    float kernel = denoiseKernel;
    float sumVarianceDiffuse, sumVarianceSpecular;
    float totalWeightDiffuse = 1., totalWeightSpecular = 1.;

    float colorPhiDiffuse = lumaPhiDiffuse, colorPhiSpecular = lumaPhiSpecular;

#ifdef USE_MOMENT
    if (horizontal && stepSize == 1.) {
        vec4 moment = textureLod(momentsTexture, vUv, 0.);

        sumVarianceDiffuse = max(0.0, moment.g - moment.r * moment.r);
        sumVarianceSpecular = max(0.0, moment.a - moment.b * moment.b);
    } else {
        sumVarianceDiffuse = diffuseLightingTexel.a;
        sumVarianceSpecular = specularLightingTexel.a;
    }

    colorPhiDiffuse = lumaPhiDiffuse * sqrt(FLOAT_EPSILON + sumVarianceDiffuse);
    colorPhiSpecular = lumaPhiSpecular * sqrt(FLOAT_EPSILON + sumVarianceSpecular);
#endif

    // horizontal / vertical
    for (float i = -kernel; i <= kernel; i++) {
        if (i != 0.) {
            vec2 neighborVec = horizontal ? vec2(i, 0.) : vec2(0., i);
            tap(neighborVec, pixelStepOffset, depth, normal, curvature, roughness, worldPos, lumaDiffuse, lumaSpecular, colorPhiDiffuse, colorPhiSpecular, diffuseLightingColor, specularLightingColor, totalWeightDiffuse, sumVarianceDiffuse, totalWeightSpecular, sumVarianceSpecular);
        }
    }

    // diagonal (top left to bottom right) / diagonal (top right to bottom left)
    for (float i = -kernel; i <= kernel; i++) {
        if (i != 0.) {
            vec2 neighborVec = horizontal ? vec2(-i, -i) : vec2(-i, i);
            tap(neighborVec, pixelStepOffset, depth, normal, curvature, roughness, worldPos, lumaDiffuse, lumaSpecular, colorPhiDiffuse, colorPhiSpecular, diffuseLightingColor, specularLightingColor, totalWeightDiffuse, sumVarianceDiffuse, totalWeightSpecular, sumVarianceSpecular);
        }
    }

    sumVarianceDiffuse /= totalWeightDiffuse * totalWeightDiffuse;
    sumVarianceSpecular /= totalWeightSpecular * totalWeightSpecular;

    diffuseLightingColor /= totalWeightDiffuse;
    specularLightingColor /= totalWeightSpecular;

    vec3 color = diffuseLightingColor;

    if (isLastIteration) {
        sumVarianceDiffuse = 1.;
        sumVarianceSpecular = 1.;
    }

    gDiffuse = vec4(diffuseLightingColor, sumVarianceDiffuse);
    gSpecular = vec4(specularLightingColor, sumVarianceSpecular);
}