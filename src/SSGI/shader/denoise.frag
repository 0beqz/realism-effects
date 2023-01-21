layout(location = 0) out vec4 gDiffuse;
layout(location = 1) out vec4 gSpecular;

varying vec2 vUv;

uniform sampler2D diffuseLightingTexture;
uniform sampler2D specularLightingTexture;
uniform sampler2D depthTexture;
uniform sampler2D normalTexture;
uniform sampler2D diffuseTexture;
uniform sampler2D momentTexture;
uniform vec2 invTexSize;
uniform bool horizontal;
uniform float denoiseDiffuse;
uniform float denoiseSpecular;
uniform float depthPhi;
uniform float normalPhi;
uniform float roughnessPhi;
uniform float denoiseKernel;
uniform float stepSize;
uniform mat4 projectionMatrixInverse;
uniform mat4 projectionMatrix;
uniform mat4 cameraMatrixWorld;
uniform bool isLastIteration;

#include <packing>

#define EPSILON      0.00001
#define M_PI         3.1415926535897932384626433832795
#define PI           M_PI

#define luminance(a) dot(vec3(0.2125, 0.7154, 0.0721), a)

#include <customComposeShaderFunctions>

vec3 screenSpaceToWorldSpace(const vec2 uv, const float depth, const mat4 curMatrixWorld) {
    vec4 ndc = vec4(
        (uv.x - 0.5) * 2.0,
        (uv.y - 0.5) * 2.0,
        (depth - 0.5) * 2.0,
        1.0);

    vec4 clip = projectionMatrixInverse * ndc;
    vec4 view = curMatrixWorld * (clip / clip.w);

    return view.xyz;
}

float distToPlane(const vec3 worldPos, const vec3 neighborWorldPos, const vec3 worldNormal) {
    vec3 toCurrent = worldPos - neighborWorldPos;
    float distToPlane = abs(dot(toCurrent, worldNormal));

    return distToPlane;
}

void tap(const vec2 neighborVec, const vec2 pixelStepOffset, const vec2 offset, const float depth, const vec3 normal, const float roughness, const vec3 worldPos, const float lumaDiffuse, const float lumaSpecular,
         const float colorPhiDiffuse, const float colorPhiSpecular,
         inout vec3 diffuseLightingColor, inout vec3 specularLightingColor, inout float totalWeightDiffuse, inout float sumVarianceDiffuse,
         inout float totalWeightSpecular, inout float sumVarianceSpecular) {
    vec2 neighborUv = vUv + neighborVec * pixelStepOffset + offset;

    vec4 neighborDepthTexel = textureLod(depthTexture, neighborUv, 0.);
    float neighborDepth = unpackRGBAToDepth(neighborDepthTexel);
    vec3 neighborWorldPos = screenSpaceToWorldSpace(neighborUv, neighborDepth, cameraMatrixWorld);

    float depthDiff = (1. - distToPlane(worldPos, neighborWorldPos, normal));

    float depthSimilarity = max(depthDiff / depthPhi, 0.);

    if (depthSimilarity < EPSILON) return;

    vec4 neighborNormalTexel = textureLod(normalTexture, neighborUv, 0.);
    vec3 neighborNormal = unpackRGBToNormal(neighborNormalTexel.rgb);
    neighborNormal = normalize((vec4(neighborNormal, 1.0) * viewMatrix).xyz);

    float normalDiff = dot(neighborNormal, normal);
    float normalSimilarity = pow(max(0., normalDiff), normalPhi);

    if (normalSimilarity < EPSILON) return;

#ifdef useRoughness
    float neighborRoughness = neighborNormalTexel.a;
    float roughnessDiff = abs(roughness - neighborRoughness);
    float roughnessSimilarity = exp(-roughnessDiff * roughnessPhi);
    if (roughnessSimilarity < EPSILON) return;
#endif

    vec4 diffuseNeighborInputTexel = textureLod(diffuseLightingTexture, neighborUv, 0.);
    vec3 diffuseNeighborColor = diffuseNeighborInputTexel.rgb;

    vec4 specularNeighborInputTexel = textureLod(specularLightingTexture, neighborUv, 0.);
    vec3 specularNeighborColor = specularNeighborInputTexel.rgb;

    float neighborLumaDiffuse = luminance(diffuseNeighborColor);
    float neighborLumaSpecular = luminance(specularNeighborColor);

    float lumaDiffDiffuse = abs(lumaDiffuse - neighborLumaDiffuse);
    float lumaDiffSpecular = abs(lumaSpecular - neighborLumaSpecular);

    float lumaSimilarityDiffuse = max(1.0 - lumaDiffDiffuse / colorPhiDiffuse, 0.0);
    float lumaSimilaritySpecular = max(1.0 - lumaDiffSpecular / colorPhiSpecular, 0.0);

    float basicWeight = normalSimilarity * depthSimilarity;

#ifdef useRoughness
    basicWeight *= roughnessSimilarity;
#endif

    float weightDiffuse = min(basicWeight * lumaSimilarityDiffuse, 1.0);
    float weightSpecular = min(basicWeight * lumaSimilaritySpecular, 1.0);

    diffuseLightingColor += diffuseNeighborColor * weightDiffuse;
    specularLightingColor += specularNeighborColor * weightSpecular;

    totalWeightDiffuse += weightDiffuse;
    totalWeightSpecular += weightSpecular;

#ifdef useMoment
    float neighborVarianceDiffuse, neighborVarianceSpecular;
    if (horizontal && stepSize == 1.) {
        vec4 neighborMoment = textureLod(momentTexture, neighborUv, 0.);

        neighborVarianceDiffuse = max(0.0, neighborMoment.g - neighborMoment.r * neighborMoment.r);
        neighborVarianceSpecular = max(0.0, neighborMoment.a - neighborMoment.b * neighborMoment.b);
    } else {
        neighborVarianceDiffuse = diffuseNeighborInputTexel.a;
        neighborVarianceSpecular = specularNeighborInputTexel.a;
    }

    sumVarianceDiffuse += weightDiffuse * weightDiffuse * neighborVarianceDiffuse;
    sumVarianceSpecular += weightSpecular * weightSpecular * neighborVarianceSpecular;
#endif
}

void main() {
    vec4 depthTexel = textureLod(depthTexture, vUv, 0.);

    // skip background
    if (dot(depthTexel.rgb, depthTexel.rgb) == 0.) {
        discard;
        return;
    }

    vec4 diffuseLightingTexel = textureLod(diffuseLightingTexture, vUv, 0.);
    vec4 specularLightingTexel = textureLod(specularLightingTexture, vUv, 0.);

    vec4 normalTexel = textureLod(normalTexture, vUv, 0.);
    vec3 viewNormal = unpackRGBToNormal(normalTexel.rgb);
    vec3 normal = normalize((vec4(viewNormal, 1.0) * viewMatrix).xyz);

    vec3 diffuseLightingColor = diffuseLightingTexel.rgb;
    vec3 specularLightingColor = specularLightingTexel.rgb;

    float depth = unpackRGBAToDepth(depthTexel);
    float lumaDiffuse = luminance(diffuseLightingColor);
    float lumaSpecular = luminance(specularLightingColor);
    vec2 pixelStepOffset = invTexSize * stepSize;

    vec3 worldPos = screenSpaceToWorldSpace(vUv, depth, cameraMatrixWorld);

    float roughness = normalTexel.a;
    vec4 diffuseTexel = textureLod(diffuseTexture, vUv, 0.);
    vec3 diffuse = diffuseTexel.rgb;
    float metalness = diffuseTexel.a;

    float kernel = denoiseKernel;
    float sumVarianceDiffuse, sumVarianceSpecular;
    float totalWeightDiffuse = 1., totalWeightSpecular = 1.;

    float colorPhiDiffuse = denoiseDiffuse, colorPhiSpecular = denoiseSpecular;

#ifdef useMoment
    if (horizontal && stepSize == 1.) {
        vec4 moment = textureLod(momentTexture, vUv, 0.);

        sumVarianceDiffuse = max(0.0, moment.g - moment.r * moment.r);
        sumVarianceSpecular = max(0.0, moment.a - moment.b * moment.b);
    } else {
        sumVarianceDiffuse = diffuseLightingTexel.a;
        sumVarianceSpecular = specularLightingTexel.a;
    }

    colorPhiDiffuse = denoiseDiffuse * sqrt(max(0.0, sumVarianceDiffuse));
    colorPhiSpecular = denoiseSpecular * sqrt(max(0.0, sumVarianceSpecular));
#endif

    int n = int(log2(stepSize));
    bool blurHorizontal = n % 2 == 0;

    vec2 bilinearOffset = invTexSize * vec2(horizontal ? 0.5 : -0.5, blurHorizontal ? 0.5 : -0.5);

    if (kernel > EPSILON) {
        if (blurHorizontal) {
            for (float i = -kernel; i <= kernel; i++) {
                if (i != 0.) {
                    vec2 neighborVec = horizontal ? vec2(i, 0.) : vec2(0., i);
                    vec2 offset = bilinearOffset;

                    tap(neighborVec, pixelStepOffset, offset, depth, normal, roughness, worldPos, lumaDiffuse, lumaSpecular, colorPhiDiffuse, colorPhiSpecular, diffuseLightingColor, specularLightingColor, totalWeightDiffuse, sumVarianceDiffuse, totalWeightSpecular, sumVarianceSpecular);
                }
            }

        } else {
            // diagonal (top left to bottom right) / diagonal (top right to bottom left)
            for (float i = -kernel; i <= kernel; i++) {
                if (i != 0.) {
                    vec2 neighborVec = horizontal ? vec2(-i, -i) : vec2(-i, i);
                    vec2 offset = bilinearOffset;

                    tap(neighborVec, pixelStepOffset, offset, depth, normal, roughness, worldPos, lumaDiffuse, lumaSpecular, colorPhiDiffuse, colorPhiSpecular, diffuseLightingColor, specularLightingColor, totalWeightDiffuse, sumVarianceDiffuse, totalWeightSpecular, sumVarianceSpecular);
                }
            }
        }

        sumVarianceDiffuse /= totalWeightDiffuse * totalWeightDiffuse;
        sumVarianceSpecular /= totalWeightSpecular * totalWeightSpecular;

        diffuseLightingColor /= totalWeightDiffuse;
        specularLightingColor /= totalWeightSpecular;
    }

    if (isLastIteration) {
#include <customComposeShader>

        sumVarianceDiffuse = 1.;
        sumVarianceSpecular = 1.;
    }

    gDiffuse = vec4(diffuseLightingColor, sumVarianceDiffuse);
    gSpecular = vec4(specularLightingColor, sumVarianceSpecular);
}