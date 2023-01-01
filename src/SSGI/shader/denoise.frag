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
uniform float denoiseKernel;
uniform float stepSize;
uniform mat4 _viewMatrix;
uniform mat4 _projectionMatrixInverse;
uniform mat4 projectionMatrix;
uniform mat4 cameraMatrixWorld;
uniform bool isLastIteration;

#include <packing>

#define EPSILON 0.00001
#define M_PI    3.1415926535897932384626433832795
#define PI      M_PI

// source: https://github.com/CesiumGS/cesium/blob/main/Source/Shaders/Builtin/Functions/luminance.glsl
float czm_luminance(vec3 rgb) {
    // Algorithm from Chapter 10 of Graphics Shaders.
    const vec3 W = vec3(0.2125, 0.7154, 0.0721);
    return dot(rgb, W);
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

void tap(vec2 neighborVec, vec2 pixelStepOffset, float depth, vec3 normal, float roughness, vec3 worldPos, float lumaDiffuse, float lumaSpecular, float colorPhiDiffuse,
         float colorPhiSpecular,
         inout vec3 diffuseLightingColor, inout vec3 specularLightingColor, inout float totalWeightDiffuse, inout float sumVarianceDiffuse,
         inout float totalWeightSpecular, inout float sumVarianceSpecular) {
    vec2 neighborUv = vUv + neighborVec * pixelStepOffset + invTexSize;

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

    float lumaDiffDiffuse = abs(lumaDiffuse - neighborLumaDiffuse);
    float lumaDiffSpecular = abs(lumaSpecular - neighborLumaSpecular);

    float roughnessDiff = abs(roughness - neighborRoughness);

    float lumaSimilarityDiffuse = max(1.0 - lumaDiffDiffuse / colorPhiDiffuse, 0.0);
    float lumaSimilaritySpecular = max(1.0 - lumaDiffSpecular / colorPhiSpecular, 0.0);

    float roughnessSimilarity = exp(-roughnessDiff * roughnessPhi);

    float basicWeight = normalSimilarity * depthSimilarity * roughnessSimilarity;
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
    vec4 diffuseLightingTexel = textureLod(diffuseLightingTexture, vUv, 0.);
    vec4 specularLightingTexel = textureLod(specularLightingTexture, vUv, 0.);

    vec4 depthTexel = textureLod(depthTexture, vUv, 0.);

    // skip background
    if (dot(depthTexel.rgb, depthTexel.rgb) == 0.) {
        gDiffuse = vec4(diffuseLightingTexel.rgb, 0.);
        gSpecular = vec4(specularLightingTexel.rgb, 0.);
        return;
    }

    vec4 normalTexel = textureLod(normalTexture, vUv, 0.);
    vec3 viewNormal = unpackRGBToNormal(normalTexel.rgb);
    vec3 normal = normalize((vec4(viewNormal, 1.0) * _viewMatrix).xyz);

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

    colorPhiDiffuse = lumaPhiDiffuse * sqrt(EPSILON + sumVarianceDiffuse);
    colorPhiSpecular = lumaPhiSpecular * sqrt(EPSILON + sumVarianceSpecular);
#endif

    // horizontal / vertical
    for (float i = -kernel; i <= kernel; i++) {
        if (i != 0.) {
            vec2 neighborVec = horizontal ? vec2(i, 0.) : vec2(0., i);
            tap(neighborVec, pixelStepOffset, depth, normal, roughness, worldPos, lumaDiffuse, lumaSpecular, colorPhiDiffuse, colorPhiSpecular, diffuseLightingColor, specularLightingColor, totalWeightDiffuse, sumVarianceDiffuse, totalWeightSpecular, sumVarianceSpecular);
        }
    }

    // diagonal (top left to bottom right) / diagonal (top right to bottom left)
    for (float i = -kernel; i <= kernel; i++) {
        if (i != 0.) {
            vec2 neighborVec = horizontal ? vec2(-i, -i) : vec2(-i, i);
            tap(neighborVec, pixelStepOffset, depth, normal, roughness, worldPos, lumaDiffuse, lumaSpecular, colorPhiDiffuse, colorPhiSpecular, diffuseLightingColor, specularLightingColor, totalWeightDiffuse, sumVarianceDiffuse, totalWeightSpecular, sumVarianceSpecular);
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