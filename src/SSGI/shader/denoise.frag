#ifdef DENOISE_DIFFUSE
layout(location = 0) out vec4 gDiffuse;
#endif

#if defined(DENOISE_DIFFUSE) && defined(DENOISE_SPECULAR)
layout(location = 1) out vec4 gSpecular;
#endif

#if !defined(DENOISE_DIFFUSE) && defined(DENOISE_SPECULAR)
layout(location = 0) out vec4 gSpecular;
#endif

varying vec2 vUv;

uniform sampler2D diffuseLightingTexture;
uniform sampler2D specularLightingTexture;
uniform sampler2D depthTexture;
uniform sampler2D normalTexture;
uniform sampler2D diffuseTexture;
uniform sampler2D momentTexture;
uniform vec2 invTexSize;
uniform bool horizontal;
uniform bool blurHorizontal;
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

void tap(const vec2 neighborVec, const vec2 pixelStepOffset, const vec2 offset, const float depth, const vec3 normal, const float roughness, const vec3 worldPos,
         const float lumaDiffuse, const float lumaSpecular,
         const float colorPhiDiffuse, const float colorPhiSpecular,
         inout vec3 diffuseLightingColor, inout vec3 specularLightingColor, inout float totalWeightDiffuse, inout float sumVarianceDiffuse,
         inout float totalWeightSpecular, inout float sumVarianceSpecular) {
    vec2 neighborUv = vUv + neighborVec * pixelStepOffset;
    vec2 bilinearNeighborUv = neighborUv + offset;  // neighborUv displaced by a half pixel to take advantage of bilinear filtering
    float basicWeight = 1.0;

// depth similarity
#ifdef useDepth
    vec4 neighborDepthTexel = textureLod(depthTexture, neighborUv, 0.);
    float neighborDepth = unpackRGBAToDepth(neighborDepthTexel);
    vec3 neighborWorldPos = screenSpaceToWorldSpace(neighborUv, neighborDepth, cameraMatrixWorld);
    float depthDiff = (1. - distToPlane(worldPos, neighborWorldPos, normal));
    float depthSimilarity = max(depthDiff / depthPhi, 0.);

    if (depthSimilarity < EPSILON) return;

    basicWeight *= depthSimilarity;
#endif

// the normal texel saves the normal in the RGB channels and the roughness in the A channel
#if defined(useNormal) || defined(useRoughness)
    vec4 neighborNormalTexel = textureLod(normalTexture, neighborUv, 0.);
#endif

// normal similarity
#ifdef useNormal
    vec3 neighborNormal = unpackRGBToNormal(neighborNormalTexel.rgb);
    neighborNormal = normalize((vec4(neighborNormal, 1.0) * viewMatrix).xyz);
    float normalDiff = dot(neighborNormal, normal);
    float normalSimilarity = pow(max(0., normalDiff), normalPhi);

    if (normalSimilarity < EPSILON) return;

    basicWeight *= normalSimilarity;
#endif

// roughness similarity
#ifdef useRoughness
    float neighborRoughness = neighborNormalTexel.a;
    float roughnessDiff = abs(roughness - neighborRoughness);
    float roughnessSimilarity = exp(-roughnessDiff * roughnessPhi);
    if (roughnessSimilarity < EPSILON) return;

    basicWeight *= roughnessSimilarity;
#endif

// denoise diffuse
#ifdef DENOISE_DIFFUSE
    vec4 diffuseNeighborInputTexel = textureLod(diffuseLightingTexture, bilinearNeighborUv, 0.);
    vec3 diffuseNeighborColor = diffuseNeighborInputTexel.rgb;

    float neighborLumaDiffuse = luminance(diffuseNeighborColor);
    float lumaDiffDiffuse = abs(lumaDiffuse - neighborLumaDiffuse);
    float lumaSimilarityDiffuse = max(1.0 - lumaDiffDiffuse / colorPhiDiffuse, 0.0);

    float weightDiffuse = min(basicWeight * lumaSimilarityDiffuse, 1.0);
    diffuseLightingColor += diffuseNeighborColor * weightDiffuse;
    totalWeightDiffuse += weightDiffuse;
#endif

// denoise specular
#ifdef DENOISE_SPECULAR
    vec4 specularNeighborInputTexel = textureLod(specularLightingTexture, bilinearNeighborUv, 0.);
    vec3 specularNeighborColor = specularNeighborInputTexel.rgb;

    float neighborLumaSpecular = luminance(specularNeighborColor);
    float lumaDiffSpecular = abs(lumaSpecular - neighborLumaSpecular);
    float lumaSimilaritySpecular = max(1.0 - lumaDiffSpecular / colorPhiSpecular, 0.0);

    float weightSpecular = min(basicWeight * lumaSimilaritySpecular, 1.0);
    specularLightingColor += specularNeighborColor * weightSpecular;
    totalWeightSpecular += weightSpecular;
#endif

// evaluate moment
#ifdef useMoment
    // first iteration
    if (horizontal && stepSize == 1.) {
        vec4 neighborMoment = textureLod(momentTexture, neighborUv, 0.);

    #ifdef DENOISE_DIFFUSE
        float neighborVarianceDiffuse = max(0.0, neighborMoment.g - neighborMoment.r * neighborMoment.r);
        sumVarianceDiffuse += weightDiffuse * weightDiffuse * neighborVarianceDiffuse;
    #endif

    #ifdef DENOISE_SPECULAR
        float neighborVarianceSpecular = max(0.0, neighborMoment.a - neighborMoment.b * neighborMoment.b);
        sumVarianceSpecular += weightSpecular * weightSpecular * neighborVarianceSpecular;
    #endif
    } else {
        // after first iteration (moment is now stored in the alpha channel)

    #ifdef DENOISE_DIFFUSE
        float neighborVarianceDiffuse = diffuseNeighborInputTexel.a;
        sumVarianceDiffuse += weightDiffuse * weightDiffuse * neighborVarianceDiffuse;
    #endif

    #ifdef DENOISE_SPECULAR
        float neighborVarianceSpecular = specularNeighborInputTexel.a;
        sumVarianceSpecular += weightSpecular * weightSpecular * neighborVarianceSpecular;
    #endif
    }
#endif
}

void main() {
    vec4 depthTexel = textureLod(depthTexture, vUv, 0.);

    // skip background
    if (dot(depthTexel.rgb, depthTexel.rgb) == 0.) {
        discard;
        return;
    }

    vec3 diffuseLightingColor, specularLightingColor;
    float lumaDiffuse, lumaSpecular;

#ifdef DENOISE_DIFFUSE
    vec4 diffuseLightingTexel = textureLod(diffuseLightingTexture, vUv, 0.);
    diffuseLightingColor = diffuseLightingTexel.rgb;
    lumaDiffuse = luminance(diffuseLightingColor);
#endif

#ifdef DENOISE_SPECULAR
    vec4 specularLightingTexel = textureLod(specularLightingTexture, vUv, 0.);
    specularLightingColor = specularLightingTexel.rgb;
    lumaSpecular = luminance(specularLightingColor);
#endif

    // g-buffers

    vec4 normalTexel = textureLod(normalTexture, vUv, 0.);
    vec3 viewNormal = unpackRGBToNormal(normalTexel.rgb);
    vec3 normal = normalize((vec4(viewNormal, 1.0) * viewMatrix).xyz);

    float depth = unpackRGBAToDepth(depthTexel);

    vec3 worldPos = screenSpaceToWorldSpace(vUv, depth, cameraMatrixWorld);

    float roughness = normalTexel.a;

    // moment

    float sumVarianceDiffuse, sumVarianceSpecular;
    float totalWeightDiffuse = 1., totalWeightSpecular = 1.;

    float colorPhiDiffuse = denoiseDiffuse, colorPhiSpecular = denoiseSpecular;

#ifdef useMoment
    if (horizontal && stepSize == 1.) {
        vec4 moment = textureLod(momentTexture, vUv, 0.);

    #ifdef DENOISE_DIFFUSE
        sumVarianceDiffuse = max(0.0, moment.g - moment.r * moment.r);
    #endif

    #ifdef DENOISE_SPECULAR
        sumVarianceSpecular = max(0.0, moment.a - moment.b * moment.b);
    #endif
    } else {
    #ifdef DENOISE_DIFFUSE
        sumVarianceDiffuse = diffuseLightingTexel.a;
    #endif

    #ifdef DENOISE_SPECULAR
        sumVarianceSpecular = specularLightingTexel.a;
    #endif
    }

    #ifdef DENOISE_DIFFUSE
    colorPhiDiffuse = denoiseDiffuse * sqrt(0.00001 + sumVarianceDiffuse);
    #endif

    #ifdef DENOISE_SPECULAR
    colorPhiSpecular = denoiseSpecular * sqrt(0.00001 + sumVarianceSpecular);
    #endif
#endif

    vec2 pixelStepOffset = invTexSize * stepSize;
    vec2 bilinearOffset = invTexSize * vec2(horizontal ? 0.5 : -0.5, blurHorizontal ? 0.5 : -0.5);

    if (denoiseKernel > EPSILON) {
        if (blurHorizontal) {
            for (float i = -denoiseKernel; i <= denoiseKernel; i++) {
                if (i != 0.) {
                    vec2 neighborVec = horizontal ? vec2(i, 0.) : vec2(0., i);
                    vec2 offset = bilinearOffset;

                    tap(neighborVec, pixelStepOffset, offset, depth, normal, roughness, worldPos, lumaDiffuse, lumaSpecular, colorPhiDiffuse, colorPhiSpecular, diffuseLightingColor, specularLightingColor, totalWeightDiffuse, sumVarianceDiffuse, totalWeightSpecular, sumVarianceSpecular);
                }
            }

        } else {
            // diagonal (top left to bottom right) / diagonal (top right to bottom left)
            for (float i = -denoiseKernel; i <= denoiseKernel; i++) {
                if (i != 0.) {
                    vec2 neighborVec = horizontal ? vec2(-i, -i) : vec2(-i, i);
                    vec2 offset = bilinearOffset;

                    tap(neighborVec, pixelStepOffset, offset, depth, normal, roughness, worldPos, lumaDiffuse, lumaSpecular, colorPhiDiffuse, colorPhiSpecular, diffuseLightingColor, specularLightingColor, totalWeightDiffuse, sumVarianceDiffuse, totalWeightSpecular, sumVarianceSpecular);
                }
            }
        }

#ifdef DENOISE_DIFFUSE
        sumVarianceDiffuse /= totalWeightDiffuse * totalWeightDiffuse;
        diffuseLightingColor /= totalWeightDiffuse;
#endif

#ifdef DENOISE_SPECULAR
        sumVarianceSpecular /= totalWeightSpecular * totalWeightSpecular;
        specularLightingColor /= totalWeightSpecular;
#endif
    }

    if (isLastIteration) {
        vec3 finalOutputColor;

        // custom compose shader
#include <customComposeShader>

#if !defined(DENOISE_DIFFUSE) && defined(DENOISE_SPECULAR)
        specularLightingColor = finalOutputColor;
#else
        diffuseLightingColor = finalOutputColor;
#endif

        sumVarianceDiffuse = 1.;
        sumVarianceSpecular = 1.;
    }

#ifdef DENOISE_DIFFUSE
    gDiffuse = vec4(diffuseLightingColor, sumVarianceDiffuse);
#endif

#ifdef DENOISE_SPECULAR
    gSpecular = vec4(specularLightingColor, sumVarianceSpecular);
#endif
}