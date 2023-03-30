#if !defined(diffuseOnly) && !defined(specularOnly)
layout(location = 0) out vec4 gDiffuse;
layout(location = 1) out vec4 gSpecular;
#else
    #ifdef diffuseOnly
layout(location = 0) out vec4 gDiffuse;
    #else
layout(location = 0) out vec4 gSpecular;
    #endif
#endif

varying vec2 vUv;

uniform sampler2D directLightTexture;
uniform sampler2D accumulatedTexture;
uniform sampler2D normalTexture;
uniform sampler2D depthTexture;
uniform sampler2D diffuseTexture;
uniform sampler2D emissiveTexture;
uniform sampler2D blueNoiseTexture;
uniform sampler2D velocityTexture;

#ifdef autoThickness
uniform sampler2D backSideDepthTexture;
#endif

uniform mat4 projectionMatrix;
uniform mat4 inverseProjectionMatrix;
uniform mat4 cameraMatrixWorld;
uniform float cameraNear;
uniform float cameraFar;
uniform float maxEnvMapMipLevel;

uniform float rayDistance;
uniform float maxRoughness;
uniform float thickness;
uniform float envBlur;

uniform int frame;
uniform vec2 texSize;
uniform vec2 blueNoiseRepeat;

struct EquirectHdrInfo {
    sampler2D marginalWeights;
    sampler2D conditionalWeights;
    sampler2D map;
    vec2 size;
    float totalSumWhole;
    float totalSumDecimal;
};

uniform EquirectHdrInfo envMapInfo;

#define INVALID_RAY_COORDS vec2(-1.0);
#define EPSILON            0.00001
#define ONE_MINUS_EPSILON  1.0 - EPSILON

float nearMinusFar;
float nearMulFar;
float farMinusNear;
vec2 invTexSize;

#include <packing>

// helper functions
#include <utils>

vec2 RayMarch(inout vec3 dir, inout vec3 hitPos);
vec2 BinarySearch(inout vec3 dir, inout vec3 hitPos);
float fastGetViewZ(const float depth);
vec3 doSample(const vec3 viewPos, const vec3 viewDir, const vec3 viewNormal, const vec3 worldPosition, const float metalness,
              const float roughness, const bool isDiffuseSample, const bool isEnvMisSample,
              const float NoV, const float NoL, const float NoH, const float LoH, const float VoH, const vec2 random, inout vec3 l,
              inout vec3 hitPos, out bool isMissedRay, out vec3 brdf, out float pdf);

void main() {
    vec4 depthTexel = textureLod(depthTexture, vUv, 0.0);

    // filter out background
    if (dot(depthTexel.rgb, depthTexel.rgb) == 0.) {
        discard;
        return;
    }

    vec4 normalTexel = textureLod(normalTexture, vUv, 0.0);
    float roughness = normalTexel.a;

    // a roughness of 1 is only being used for deselected meshes
    if (roughness == 1.0 || roughness > maxRoughness) {
        discard;
        return;
    }

    invTexSize = 1. / texSize;

    roughness = clamp(roughness * roughness, 0.0001, 1.0);

    // pre-calculated variables for the "fastGetViewZ" function
    nearMinusFar = cameraNear - cameraFar;
    nearMulFar = cameraNear * cameraFar;
    farMinusNear = cameraFar - cameraNear;

    float unpackedDepth = unpackRGBAToDepth(depthTexel);
    // view-space depth
    float depth = fastGetViewZ(unpackedDepth);

    // view-space position of the current texel
    vec3 viewPos = getViewPosition(depth);

    vec3 viewDir = normalize(viewPos);
    vec3 worldNormal = normalTexel.xyz;
    vec3 viewNormal = normalize((vec4(worldNormal, 1.) * cameraMatrixWorld).xyz);

    vec3 worldPos = vec4(vec4(viewPos, 1.) * viewMatrix).xyz;

    vec4 diffuseTexel = textureLod(diffuseTexture, vUv, 0.);
    vec3 diffuse = diffuseTexel.rgb;
    float metalness = diffuseTexel.a;

    vec3 n = viewNormal;  // view-space normal
    vec3 v = -viewDir;    // incoming vector
    float NoV = max(EPSILON, dot(n, v));

    // convert view dir to world-space
    vec3 V = (vec4(v, 1.) * viewMatrix).xyz;
    vec3 N = worldNormal;

    vec4 blueNoise;
    vec3 H, l, h, F, T, B, envMisDir, gi;
    vec3 diffuseGI, specularGI, brdf, hitPos;

    Onb(N, T, B);

    V = ToLocal(T, B, N, V);

    // fresnel f0
    vec3 f0 = mix(vec3(0.04), diffuse, metalness);

    float NoL, NoH, LoH, VoH, diffW, specW, invW, pdf, envPdf, diffuseSamples, specularSamples, envMisProbability, envMisMultiplier;
    bool isDiffuseSample, isEnvMisSample, isMissedRay;

    int sampleCounter = 0;

    // start taking samples

#pragma unroll_loop_start
    for (int i = 0; i < spp; i++) {
        blueNoise = sampleBlueNoise(frame + sampleCounter++);

        // Disney BRDF and sampling source: https://www.shadertoy.com/view/cll3R4
        // calculate GGX reflection ray
        H = SampleGGXVNDF(V, roughness, roughness, blueNoise.r, blueNoise.g);
        if (H.z < 0.0) H = -H;

        l = normalize(reflect(-V, H));
        l = ToWorld(T, B, N, l);

        // convert reflected vector back to view-space
        l = (vec4(l, 1.) * cameraMatrixWorld).xyz;
        l = normalize(l);

        h = normalize(v + l);  // half vector

        NoL = clamp(dot(n, l), EPSILON, ONE_MINUS_EPSILON);
        NoH = clamp(dot(n, h), EPSILON, ONE_MINUS_EPSILON);
        LoH = clamp(dot(l, h), EPSILON, ONE_MINUS_EPSILON);
        VoH = clamp(dot(v, h), EPSILON, ONE_MINUS_EPSILON);

#if !defined(diffuseOnly) && !defined(specularOnly)
        // fresnel
        F = F_Schlick(f0, VoH);

        // diffuse and specular weight
        diffW = (1. - metalness) * luminance(diffuse);
        specW = luminance(F);

        diffW = max(diffW, EPSILON);
        specW = max(specW, EPSILON);

        invW = 1. / (diffW + specW);

        // relative weights used for choosing either a diffuse or specular ray
        diffW *= invW;
        specW *= invW;

        // if diffuse lighting should be sampled
        isDiffuseSample = blueNoise.b < diffW;
#else
    #ifdef diffuseOnly
        isDiffuseSample = true;
    #else
        isDiffuseSample = false;
    #endif
#endif
        envMisDir = vec3(0.0);

#ifdef importanceSampling
        envPdf = sampleEquirectProbability(envMapInfo, blueNoise.rg, envMisDir);
        envMisDir = normalize((vec4(envMisDir, 1.) * cameraMatrixWorld).xyz);

        envMisProbability = 0.25 + dot(envMisDir, viewNormal) * 0.5;
        isEnvMisSample = blueNoise.a < envMisProbability;

        envMisMultiplier = 1. / (1. - envMisProbability);

        if (isEnvMisSample) {
            envPdf /= 1. - envMisProbability;
        } else {
            envPdf = 0.0001;
        }
#else
        envPdf = 0.0;
        envMisMultiplier = 1.;
#endif

        if (isDiffuseSample) {
            if (isEnvMisSample) {
                l = envMisDir;
            } else {
                l = cosineSampleHemisphere(viewNormal, blueNoise.rg);
            }

            h = normalize(v + l);  // half vector

            NoL = clamp(dot(n, l), EPSILON, ONE_MINUS_EPSILON);
            NoH = clamp(dot(n, h), EPSILON, ONE_MINUS_EPSILON);
            LoH = clamp(dot(l, h), EPSILON, ONE_MINUS_EPSILON);
            VoH = clamp(dot(v, h), EPSILON, ONE_MINUS_EPSILON);

            gi = doSample(
                viewPos, viewDir, viewNormal, worldPos, metalness, roughness, isDiffuseSample, isEnvMisSample, NoV, NoL, NoH, LoH, VoH, blueNoise.rg,
                l, hitPos, isMissedRay, brdf, pdf);

            gi *= brdf;

            if (isEnvMisSample) {
                gi *= misHeuristic(envPdf, pdf);
                gi /= envPdf;
            } else {
                gi /= pdf;
                gi *= envMisMultiplier;
            }

            diffuseSamples++;

            diffuseGI = mix(diffuseGI, gi, 1. / diffuseSamples);

        } else {
            isEnvMisSample = isEnvMisSample && roughness >= 0.025;
            if (isEnvMisSample) {
                l = envMisDir;

                h = normalize(v + l);  // half vector

                NoL = clamp(dot(n, l), EPSILON, ONE_MINUS_EPSILON);
                NoH = clamp(dot(n, h), EPSILON, ONE_MINUS_EPSILON);
                LoH = clamp(dot(l, h), EPSILON, ONE_MINUS_EPSILON);
                VoH = clamp(dot(v, h), EPSILON, ONE_MINUS_EPSILON);
            }

            gi = doSample(
                viewPos, viewDir, viewNormal, worldPos, metalness, roughness, isDiffuseSample, isEnvMisSample, NoV, NoL, NoH, LoH, VoH, blueNoise.rg,
                l, hitPos, isMissedRay, brdf, pdf);

            gi *= brdf;

            if (isEnvMisSample) {
                gi *= misHeuristic(envPdf, pdf);
                gi /= envPdf;
            } else {
                gi /= pdf;
                gi *= envMisMultiplier;
            }

            specularSamples++;

            specularGI = mix(specularGI, gi, 1. / specularSamples);
        }
    }
#pragma unroll_loop_end

    roughness = sqrt(roughness);

    vec2 uv = viewSpaceToScreenSpace(viewPos);

#ifndef specularOnly
    if (diffuseSamples == 0.0) diffuseGI = vec3(-1.0);
    gDiffuse = vec4(diffuseGI, roughness);
#endif

#ifndef diffuseOnly
    // calculate world-space ray length used for reprojecting hit points instead of screen-space pixels in the temporal reproject pass
    float rayLength = 0.0;

    if (!isMissedRay && roughness < 0.375 && getCurvature(viewNormal, depth) < 0.0005) {
        vec3 hitPosWS = (vec4(hitPos, 1.) * viewMatrix).xyz;
        rayLength = distance(worldPos, hitPosWS);
    }

    if (specularSamples == 0.0) specularGI = vec3(-1.0);
    gSpecular = vec4(specularGI, rayLength);
#endif
}

vec3 doSample(const vec3 viewPos, const vec3 viewDir, const vec3 viewNormal, const vec3 worldPosition, const float metalness,
              const float roughness, const bool isDiffuseSample, const bool isEnvMisSample,
              const float NoV, const float NoL, const float NoH, const float LoH, const float VoH, const vec2 random, inout vec3 l,
              inout vec3 hitPos, out bool isMissedRay, out vec3 brdf, out float pdf) {
    float cosTheta = max(0.0, dot(viewNormal, l));

    if (isDiffuseSample) {
        vec3 diffuseBrdf = vec3(evalDisneyDiffuse(NoL, NoV, LoH, roughness, metalness));
        pdf = NoL / M_PI;
        pdf = max(EPSILON, pdf);

        brdf = diffuseBrdf;
    } else {
        vec3 specularBrdf = evalDisneySpecular(roughness, NoH, NoV, NoL);
        pdf = GGXVNDFPdf(NoH, NoV, roughness);
        pdf = max(EPSILON, pdf);

        brdf = specularBrdf;
    }

    brdf *= cosTheta;

    hitPos = viewPos;

#if steps == 0
    hitPos += l;

    vec2 coords = viewSpaceToScreenSpace(hitPos);
#else
    vec2 coords = RayMarch(l, hitPos);
#endif

    bool allowMissedRays = false;
#ifdef missedRays
    allowMissedRays = true;
#endif

    isMissedRay = coords.x == -1.0;

    vec3 envMapSample = vec3(0.);

    // inisEnvMisSample ray, use environment lighting as fallback
    if (isMissedRay || allowMissedRays) {
#ifdef USE_ENVMAP
        // world-space reflected ray
        vec3 reflectedWS = normalize((vec4(l, 1.) * viewMatrix).xyz);

    #ifdef BOX_PROJECTED_ENV_MAP
        reflectedWS = parallaxCorrectNormal(reflectedWS.xyz, envMapSize, envMapPosition, worldPosition);
        reflectedWS = normalize(reflectedWS.xyz);
    #endif

        float mip = envBlur * maxEnvMapMipLevel;

        if (!isDiffuseSample && roughness < 0.15) mip *= roughness / 0.15;

        envMapSample = sampleEquirectEnvMapColor(reflectedWS, envMapInfo.map, mip);

        float maxEnvLum = isEnvMisSample ? 50.0 : 5.0;

        if (maxEnvLum != 0.0) {
            // we won't deal with calculating direct sun light from the env map as it is too noisy
            float envLum = luminance(envMapSample);

            if (envLum > maxEnvLum) {
                envMapSample *= maxEnvLum / envLum;
            }
        }

        return envMapSample;
#else
        // if we don't have an environment map, just return black
        return vec3(0.0);
#endif
    }

    // reproject the coords from the last frame
    vec4 velocity = textureLod(velocityTexture, coords.xy, 0.0);

    vec2 reprojectedUv = coords.xy - velocity.xy;

    vec3 SSGI;

    // check if the reprojected coordinates are within the screen
    if (reprojectedUv.x >= 0.0 && reprojectedUv.x <= 1.0 && reprojectedUv.y >= 0.0 && reprojectedUv.y <= 1.0) {
        vec4 emissiveTexel = textureLod(emissiveTexture, coords.xy, 0.);
        vec3 emissiveColor = emissiveTexel.rgb * 10.;

        vec3 reprojectedGI = getTexel(accumulatedTexture, reprojectedUv, 0.).rgb;

        SSGI = reprojectedGI + emissiveColor;

#ifdef useDirectLight
        SSGI += textureLod(directLightTexture, coords.xy, 0.).rgb * directLightMultiplier;
#endif
    } else {
        SSGI = textureLod(directLightTexture, vUv, 0.).rgb;
    }

    if (allowMissedRays) {
        float ssgiLum = luminance(SSGI);
        float envLum = luminance(envMapSample);

        if (envLum > ssgiLum) SSGI = envMapSample;
    }

    return SSGI;
}

vec2 RayMarch(inout vec3 dir, inout vec3 hitPos) {
    float rayHitDepthDifference;

    dir *= rayDistance / float(steps);

    vec2 uv;

    for (int i = 1; i < steps; i++) {
        // use slower increments for the first few steps to sharpen contact shadows
        float m = exp(pow(float(i) / 4.0, 0.05)) - 2.0;
        hitPos += dir * min(m, 1.);

        if (hitPos.z > 0.0) return INVALID_RAY_COORDS;

        uv = viewSpaceToScreenSpace(hitPos);

#ifndef missedRays
        if (uv.x < 0. || uv.y < 0. || uv.x > 1. || uv.y > 1.) return INVALID_RAY_COORDS;
#endif

        float unpackedDepth = unpackRGBAToDepth(textureLod(depthTexture, uv, 0.0));
        float depth = fastGetViewZ(unpackedDepth);

#ifdef autoThickness
        float unpackedBackSideDepth = unpackRGBAToDepth(textureLod(backSideDepthTexture, uv, 0.0));
        float backSideDepth = fastGetViewZ(unpackedBackSideDepth);

        float currentThickness = max(abs(depth - backSideDepth), thickness);
#else
        float currentThickness = thickness;
#endif

        rayHitDepthDifference = depth - hitPos.z;

        if (rayHitDepthDifference >= 0.0 && rayHitDepthDifference < currentThickness) {
#if refineSteps == 0
            return uv;
#else
            return BinarySearch(dir, hitPos);
#endif
        }
    }

#ifndef missedRays
    return INVALID_RAY_COORDS;
#endif

    return uv;
}

vec2 BinarySearch(inout vec3 dir, inout vec3 hitPos) {
    float rayHitDepthDifference;
    vec2 uv;

    dir *= 0.5;
    hitPos -= dir;

    for (int i = 0; i < refineSteps; i++) {
        uv = viewSpaceToScreenSpace(hitPos);

        float unpackedDepth = unpackRGBAToDepth(textureLod(depthTexture, uv, 0.0));
        float depth = fastGetViewZ(unpackedDepth);

        rayHitDepthDifference = depth - hitPos.z;

        dir *= 0.5;
        hitPos += rayHitDepthDifference > 0.0 ? -dir : dir;
    }

    uv = viewSpaceToScreenSpace(hitPos);

    return uv;
}

// source: https://github.com/mrdoob/three.js/blob/342946c8392639028da439b6dc0597e58209c696/examples/js/shaders/SAOShader.js#L123
float fastGetViewZ(const float depth) {
#ifdef PERSPECTIVE_CAMERA
    return nearMulFar / (farMinusNear * depth - cameraFar);
#else
    return depth * nearMinusFar - cameraNear;
#endif
}