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
uniform vec3 cameraPos;

uniform float rayDistance;
uniform float maxRoughness;
uniform float thickness;
uniform float envBlur;
uniform float maxEnvLuminance;

uniform float frames;
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

const vec4 blueNoiseSeed = vec4(1.618033988749895, 1.3247179572447458, 1.2207440846057596, 1.1673039782614187);

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
float getCurvature(const vec3 worldNormal);
vec3 doSample(const vec3 viewPos, const vec3 viewDir, const vec3 viewNormal, const vec3 worldPosition, const float metalness,
              const float roughness, const bool isDiffuseSample, const bool isMisSample,
              const float NoV, const float NoL, const float NoH, const float LoH, const float VoH, const vec2 random, inout vec3 l,
              inout vec3 hitPos, out bool isMissedRay, out vec3 brdf, out float pdf);

vec2 hash(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
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

    rng_initialize(vUv * texSize, int(frames));

    invTexSize = 1. / texSize;

    roughness = clamp(roughness * roughness, 0.0001, 1.0);

    float unpackedDepth = unpackRGBAToDepth(depthTexel);

    normalTexel.xyz = unpackRGBToNormal(normalTexel.rgb);

    // pre-calculated variables for the "fastGetViewZ" function
    nearMinusFar = cameraNear - cameraFar;
    nearMulFar = cameraNear * cameraFar;
    farMinusNear = cameraFar - cameraNear;

    // view-space depth
    float depth = fastGetViewZ(unpackedDepth);

    // view-space position of the current texel
    vec3 viewPos = getViewPosition(depth);
    vec3 viewDir = normalize(viewPos);
    vec3 viewNormal = normalTexel.xyz;

    vec3 worldPos = vec4(vec4(viewPos, 1.) * viewMatrix).xyz;

    vec4 diffuseTexel = textureLod(diffuseTexture, vUv, 0.);
    vec3 diffuse = diffuseTexel.rgb;
    float metalness = diffuseTexel.a;

    vec3 n = viewNormal;  // view-space normal
    vec3 v = -viewDir;    // incoming vector
    float NoV = max(EPSILON, dot(n, v));

    // convert view dir and view normal to world-space
    vec3 V = (vec4(v, 1.) * viewMatrix).xyz;
    vec3 N = (vec4(n, 1.) * viewMatrix).xyz;

    bool isMissedRay;
    vec3 SSGI, diffuseGI, specularGI, brdf, hitPos, T, B;
    float pdf;

    Onb(N, T, B);

    V = ToLocal(T, B, N, V);
    float diffuseSamples, specularSamples;

    // fresnel f0
    vec3 f0 = mix(vec3(0.04), diffuse, metalness);

    vec4 velocity = textureLod(velocityTexture, vUv, 0.0);

    // init blue noise
    vec2 size = vUv * texSize;
    vec2 blueNoiseSize = texSize / blueNoiseRepeat;
    float blueNoiseIndex = floor(floor(size.y / blueNoiseSize.y) * blueNoiseRepeat.x) + floor(size.x / blueNoiseSize.x);

    // get the offset of this pixel's blue noise tile
    float blueNoiseTileOffset = r1(blueNoiseIndex + 1.0) * 65536.;

    // start taking samples
    for (int s = 0; s < spp; s++) {
        vec2 blueNoiseUv = vec2(shift2()) * blueNoiseRepeat * invTexSize;

        // fetch blue noise for this pixel
        vec4 blueNoise = textureLod(blueNoiseTexture, blueNoiseUv, 0.);

        // animate the blue noise depending on the frame and samples taken this frame
        blueNoise = fract(blueNoise + blueNoiseSeed * (frames + float(s) + blueNoiseTileOffset));

        // Disney BRDF and sampling source: https://www.shadertoy.com/view/cll3R4
        // calculate GGX reflection ray
        vec3 H = SampleGGXVNDF(V, roughness, roughness, blueNoise.r, blueNoise.g);
        if (H.z < 0.0) H = -H;

        vec3 l = normalize(reflect(-V, H));
        l = ToWorld(T, B, N, l);

        // convert reflected vector back to view-space
        l = (vec4(l, 1.) * cameraMatrixWorld).xyz;
        l = normalize(l);

        vec3 h = normalize(v + l);  // half vector

        float NoL = clamp(dot(n, l), EPSILON, ONE_MINUS_EPSILON);
        float NoH = clamp(dot(n, h), EPSILON, ONE_MINUS_EPSILON);
        float LoH = clamp(dot(l, h), EPSILON, ONE_MINUS_EPSILON);
        float VoH = clamp(dot(v, h), EPSILON, ONE_MINUS_EPSILON);

#if !defined(diffuseOnly) && !defined(specularOnly)
        // fresnel
        vec3 F = F_Schlick(f0, VoH);

        // diffuse and specular weight
        float diffW = (1. - metalness) * luminance(diffuse);
        float specW = luminance(F);

        diffW = max(diffW, EPSILON);
        specW = max(specW, EPSILON);

        float invW = 1. / (diffW + specW);

        // relative weights used for choosing either a diffuse or specular ray
        diffW *= invW;
        specW *= invW;

        // if diffuse lighting should be sampled
        bool isDiffuseSample = blueNoise.b < diffW;
#else
    #ifdef diffuseOnly
        const bool isDiffuseSample = true;
    #else
        const bool isDiffuseSample = false;
    #endif
#endif

        vec3 envMisDir = vec3(0.0);
        float envPdf = 0.0;

#ifdef importanceSampling
        envPdf = sampleEquirectProbability(envMapInfo, blueNoise.rg, envMisDir);
        envMisDir = normalize((vec4(envMisDir, 1.) * cameraMatrixWorld).xyz);
#endif

        bool valid = blueNoise.a < 0.25 + dot(envMisDir, viewNormal) * 0.5;
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

            vec3 gi = doSample(
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

            vec3 gi = doSample(
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

#ifndef specularOnly
    gDiffuse = vec4(diffuseGI, sqrt(roughness));
#endif

#ifndef diffuseOnly
    // calculate world-space ray length used for reprojecting hit points instead of screen-space pixels in the temporal reproject pass
    float rayLength = specularSamples > 0.0 ? 0.0 : -1.0;
    if (!isMissedRay && roughness < 0.5) {
        vec3 worldNormal = (vec4(viewNormal, 1.) * viewMatrix).xyz;

        float curvature = getCurvature(worldNormal);

        if (curvature < 0.001) {
            vec3 hitPosWS = (vec4(hitPos, 1.) * viewMatrix).xyz;
            rayLength = distance(worldPos, hitPosWS);
        }
    }

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
    vec2 coords = RayMarch(l, hitPos);
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
        vec4 reflectedWS = vec4(l, 1.) * viewMatrix;
        reflectedWS.xyz = normalize(reflectedWS.xyz);

    #ifdef BOX_PROJECTED_ENV_MAP
        float depth = unpackRGBAToDepth(textureLod(depthTexture, vUv, 0.));
        reflectedWS.xyz = parallaxCorrectNormal(reflectedWS.xyz, envMapSize, envMapPosition, worldPosition);
        reflectedWS.xyz = normalize(reflectedWS.xyz);
    #endif

        float mip = envBlur * maxEnvMapMipLevel;

        if (!isDiffuseSample) mip *= sqrt(roughness);

        vec3 sampleDir = reflectedWS.xyz;
        envMapSample = sampleEquirectEnvMapColor(sampleDir, envMapInfo.map, mip);

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

    for (int i = 0; i < steps; i++) {
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

float getCurvature(const vec3 worldNormal) {
    vec3 dx = dFdx(worldNormal);
    vec3 dy = dFdy(worldNormal);

    float x = dot(dx, dx);
    float y = dot(dy, dy);

    return sqrt(x * x + y * y);
}