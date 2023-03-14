﻿#if !defined(diffuseOnly) && !defined(specularOnly)
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
uniform vec3 cameraPos;

uniform float rayDistance;
uniform float maxRoughness;
uniform float thickness;
uniform float envBlur;
uniform float maxEnvLuminance;

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
              const float roughness, const bool isDiffuseSample, const bool isMisSample,
              const float NoV, const float NoL, const float NoH, const float LoH, const float VoH, const vec2 random, inout vec3 l,
              inout vec3 hitPos, out bool isMissedRay, out vec3 brdf, out float pdf);

vec4 trace(vec3 positionFrom, vec3 pivot) {
    float maxDistance = rayDistance;
    float resolution = 0.5;

    vec2 texCoord = vUv;

    vec4 uv = vec4(0.0);

    vec3 unitPositionFrom = normalize(positionFrom.xyz);

    vec4 positionTo = vec4(positionFrom, 1.);

    vec4 startView = vec4(positionFrom.xyz + (pivot * 0.), 1.0);
    vec4 endView = vec4(positionFrom.xyz + (pivot * maxDistance), 1.0);

    vec2 startFrag = viewSpaceToScreenSpace(startView.xyz) * texSize;
    vec2 endFrag = viewSpaceToScreenSpace(endView.xyz) * texSize;

    vec2 frag = startFrag.xy;
    uv.xy = frag / texSize;

    float deltaX = endFrag.x - startFrag.x;
    float deltaY = endFrag.y - startFrag.y;
    float useX = abs(deltaX) >= abs(deltaY) ? 1.0 : 0.0;
    float delta = mix(abs(deltaY), abs(deltaX), useX) * clamp(resolution, 0.0, 1.0);
    vec2 increment = vec2(deltaX, deltaY) / max(delta, 0.001);

    float search0 = 0.;
    float search1 = 0.;

    int hit0 = 0;
    int hit1 = 0;

    float viewDistance, depth;

    float i = 0.;

    if (delta > 10000.0) {
        return vec4(0.0);
    }

    vec2 t = vec2(deltaX, deltaY) / float(steps);

    frag += t * 5.0;

    for (i = 0.; i < float(steps); ++i) {
        frag += t;
        uv.xy = frag / texSize;

        float unpackedDepth = unpackRGBAToDepth(textureLod(depthTexture, uv.xy, 0.0));
        positionTo = vec4(getViewPosition(getViewZ(unpackedDepth)), 1.);

        search1 =
            mix((frag.y - startFrag.y) / deltaY, (frag.x - startFrag.x) / deltaX, useX);

        search1 = clamp(search1, 0.0, 1.0);

        viewDistance = (startView.z * endView.z) / mix(endView.z, startView.z, search1);
        depth = viewDistance - positionTo.z;

        if (depth > 0. && depth < thickness * 0.1) {
            hit0 = 1;
            break;
        } else {
            search0 = search1;
        }
    }

    if (hit0 == 0) {
        return vec4(-1.0);
    }

    // ---------

    search1 = search0 + ((search1 - search0) / 2.0);

    for (i = 0.; i < float(refineSteps); ++i) {
        frag = mix(startFrag.xy, endFrag.xy, search1);
        uv.xy = frag / texSize;

        float unpackedDepth = unpackRGBAToDepth(textureLod(depthTexture, uv.xy, 0.0));
        positionTo = vec4(getViewPosition(getViewZ(unpackedDepth)), 1.);

        viewDistance = (startView.z * endView.z) / mix(endView.z, startView.z, search1);
        depth = viewDistance - positionTo.z;

        if (depth > 0. && depth < thickness * 0.1) {
            hit1 = 1;
            search1 = search0 + ((search1 - search0) / 2.);
        } else {
            float temp = search1;
            search1 = search1 + ((search1 - search0) / 2.);
            search0 = temp;
        }
    }

    if (hit1 == 0) {
        return vec4(-1.0);
    }

    float visibility = positionTo.w * (1. - max(dot(-unitPositionFrom, pivot), 0.)) * (1. - clamp(depth / thickness, 0., 1.)) * (1. - clamp(length(positionTo.xyz - positionFrom.xyz) / maxDistance, 0., 1.)) * (uv.x < 0. || uv.x > 1. ? 0. : 1.) * (uv.y < 0. || uv.y > 1. ? 0. : 1.);

    visibility = clamp(visibility, 0., 1.);

    if (visibility == 0.0) {
        return vec4(-1.);
    }

    return uv;
}

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

    // vec4 uv = trace(viewPos, viewNormal);
    // vec4 t = uv.x >= 0. ? texture(diffuseTexture, uv.xy) : vec4(0.);
    // gDiffuse = uv;
    // gSpecular = t;
    // return;

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
    vec3 SSGI, diffuseGI, specularGI, brdf, hitPos;

    Onb(N, T, B);

    V = ToLocal(T, B, N, V);

    // fresnel f0
    vec3 f0 = mix(vec3(0.04), diffuse, metalness);

    float NoL, NoH, LoH, VoH, diffW, specW, invW, pdf, envPdf, diffuseSamples, specularSamples;
    bool isDiffuseSample, valid, isMissedRay;

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
        envPdf = 0.0;

#ifdef importanceSampling
        envPdf = sampleEquirectProbability(envMapInfo, blueNoise.rg, envMisDir);
        envMisDir = normalize((vec4(envMisDir, 1.) * cameraMatrixWorld).xyz);
#endif

        valid = blueNoise.a < 0.25 + dot(envMisDir, viewNormal) * 0.5;
        if (!valid) envPdf = 0.0;

        if (isDiffuseSample) {
            if (envPdf == 0.0) {
                l = cosineSampleHemisphere(viewNormal, blueNoise.rg);
            } else {
                l = envMisDir;
            }

            h = normalize(v + l);  // half vector

            NoL = clamp(dot(n, l), EPSILON, ONE_MINUS_EPSILON);
            NoH = clamp(dot(n, h), EPSILON, ONE_MINUS_EPSILON);
            LoH = clamp(dot(l, h), EPSILON, ONE_MINUS_EPSILON);
            VoH = clamp(dot(v, h), EPSILON, ONE_MINUS_EPSILON);

            gi = doSample(
                viewPos, viewDir, viewNormal, worldPos, metalness, roughness, isDiffuseSample, envPdf != 0.0, NoV, NoL, NoH, LoH, VoH, blueNoise.rg,
                l, hitPos, isMissedRay, brdf, pdf);

            gi *= brdf;

            if (envPdf == 0.0) {
                gi /= pdf;
            } else {
                gi *= misHeuristic(envPdf, pdf);
                gi /= envPdf;
            }

            diffuseSamples++;

            diffuseGI = mix(diffuseGI, gi, 1. / diffuseSamples);

        } else {
            if (envPdf != 0.0 && roughness >= 0.025) {
                l = envMisDir;

                h = normalize(v + l);  // half vector

                NoL = clamp(dot(n, l), EPSILON, ONE_MINUS_EPSILON);
                NoH = clamp(dot(n, h), EPSILON, ONE_MINUS_EPSILON);
                LoH = clamp(dot(l, h), EPSILON, ONE_MINUS_EPSILON);
                VoH = clamp(dot(v, h), EPSILON, ONE_MINUS_EPSILON);
            } else {
                envPdf = 0.0;
            }

            gi = doSample(
                viewPos, viewDir, viewNormal, worldPos, metalness, roughness, isDiffuseSample, envPdf != 0.0, NoV, NoL, NoH, LoH, VoH, blueNoise.rg,
                l, hitPos, isMissedRay, brdf, pdf);

            gi *= brdf;

            if (envPdf == 0.0) {
                gi /= pdf;
            } else {
                gi *= misHeuristic(envPdf, pdf);
                gi /= envPdf;
            }

            specularSamples++;

            specularGI = mix(specularGI, gi, 1. / specularSamples);
        }
    }
#pragma unroll_loop_end

    roughness = sqrt(roughness);

#ifndef specularOnly
    if (diffuseSamples == 0.0) diffuseGI = vec3(-1.0);
    gDiffuse = vec4(diffuseGI, roughness);
#endif

#ifndef diffuseOnly
    // calculate world-space ray length used for reprojecting hit points instead of screen-space pixels in the temporal reproject pass
    float rayLength = 0.0;

    if (!isMissedRay && roughness < 0.375 && getCurvature(viewNormal, depth) < 0.001) {
        vec3 hitPosWS = (vec4(hitPos, 1.) * viewMatrix).xyz;
        rayLength = distance(worldPos, hitPosWS);
    }

    if (specularSamples == 0.0) specularGI = vec3(-1.0);
    gSpecular = vec4(specularGI, rayLength);
#endif
}

vec3 doSample(const vec3 viewPos, const vec3 viewDir, const vec3 viewNormal, const vec3 worldPosition, const float metalness,
              const float roughness, const bool isDiffuseSample, const bool isMisSample,
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
    vec2 coords = trace(hitPos, normalize(l)).xy;
#endif

    bool allowMissedRays = false;
#ifdef missedRays
    allowMissedRays = true;
#endif

    isMissedRay = coords.x == -1.0;

    vec3 envMapSample = vec3(0.);

#ifdef USE_ENVMAP
    // invalid ray, use environment lighting as fallback
    if (isMissedRay || allowMissedRays) {
        // world-space reflected ray
        vec3 reflectedWS = normalize((vec4(l, 1.) * viewMatrix).xyz);

    #ifdef BOX_PROJECTED_ENV_MAP
        float depth = unpackRGBAToDepth(textureLod(depthTexture, vUv, 0.));
        reflectedWS = parallaxCorrectNormal(reflectedWS.xyz, envMapSize, envMapPosition, worldPosition);
        reflectedWS = normalize(reflectedWS.xyz);
    #endif

        float mip = envBlur * maxEnvMapMipLevel;

        if (!isDiffuseSample) mip *= sqrt(roughness);

        envMapSample = sampleEquirectEnvMapColor(reflectedWS, envMapInfo.map, mip);

        float maxEnvLum = isMisSample ? maxEnvLuminance : 5.0;

        if (maxEnvLum != 0.0) {
            // we won't deal with calculating direct sun light from the env map as it is too noisy
            float envLum = luminance(envMapSample);

            if (envLum > maxEnvLum) {
                envMapSample *= maxEnvLum / envLum;
            }
        }

        return envMapSample;
    }
#endif

    // reproject the coords from the last frame
    vec4 velocity = textureLod(velocityTexture, coords.xy, 0.0);

    vec2 reprojectedUv = coords.xy - velocity.xy;

    vec3 SSGI;

    bvec4 reprojectedUvInScreen = bvec4(
        greaterThanEqual(reprojectedUv, vec2(0.)),
        lessThanEqual(reprojectedUv, vec2(1.)));

    // check if the reprojected coordinates are within the screen
    if (all(reprojectedUvInScreen)) {
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
    float stepsFloat = float(steps);
    float rayHitDepthDifference;

    dir *= rayDistance / float(steps);

    vec2 uv;

    for (int i = 1; i < steps; i++) {
        hitPos += dir;
        if (hitPos.z > 0.0) return INVALID_RAY_COORDS;

        uv = viewSpaceToScreenSpace(hitPos);

#ifndef missedRays
        if (any(lessThan(uv, vec2(0.))) || any(greaterThan(uv, vec2(1.)))) return INVALID_RAY_COORDS;
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