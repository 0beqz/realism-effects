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
uniform sampler2D envMap;

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
uniform vec2 invTexSize;
uniform vec2 blueNoiseRepeat;

uniform float samples;
uniform vec2 blueNoiseOffset;

uniform float jitter;
uniform float jitterRoughness;
uniform float envBlur;
uniform float maxEnvLuminance;

#define INVALID_RAY_COORDS vec2(-1.0);
#define EARLY_OUT_COLOR    vec4(0.0, 0.0, 0.0, 0.0)
#define EPSILON            0.00001
#define ONE_MINUS_EPSILON  1.0 - EPSILON
#define luminance(a)       dot(vec3(0.2125, 0.7154, 0.0721), a)

float nearMinusFar;
float nearMulFar;
float farMinusNear;

#include <packing>

// helper functions
#include <utils>

vec2 RayMarch(inout vec3 dir, inout vec3 hitPos);
vec2 BinarySearch(inout vec3 dir, inout vec3 hitPos);
float fastGetViewZ(const float depth);
float getCurvature(const vec3 worldNormal);
vec3 doSample(const vec3 viewPos, const vec3 viewDir, const vec3 viewNormal, const vec3 worldPosition, const float metalness,
              const float roughness, const bool isDiffuseSample, const float NoV, const float NoL, const float NoH, const float LoH,
              const float VoH, const vec2 random, inout vec3 l, inout vec3 hitPos, out bool isMissedRay, out vec3 brdf);

void main() {
    vec4 depthTexel = textureLod(depthTexture, vUv, 0.0);

    // filter out background
    if (dot(depthTexel.rgb, depthTexel.rgb) == 0.) {
        discard;
        return;
    }

    vec4 normalTexel = textureLod(normalTexture, vUv, 0.0);
    float roughnessValue = normalTexel.a;

    // a roughness of 1 is only being used for deselected meshes
    if (roughnessValue == 1.0 || roughnessValue > maxRoughness) {
        discard;
        return;
    }

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

    float roughness = jitter + roughnessValue * jitterRoughness;
    roughness = clamp(roughness * roughness, 0.0001, 1.0);

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
    vec2 sampleOffset;
    vec3 SSGI, diffuseGI, specularGI, brdf, hitPos, T, B;

    Onb(N, T, B);

    V = ToLocal(T, B, N, V);
    float diffuseSamples, specularSamples;

    // fresnel f0
    vec3 f0 = mix(vec3(0.04), diffuse, metalness);

    float sppPlus1 = float(spp + 1);

    // start taking samples
    for (int s = 0; s < spp; s++) {
        float sF = float(s);
        if (s != 0) sampleOffset = vec2(sF / sppPlus1);

        vec2 blueNoiseUv = (vUv + blueNoiseOffset + sampleOffset) * blueNoiseRepeat;
        vec3 random = textureLod(blueNoiseTexture, blueNoiseUv, 0.).rgb;

        // calculate GGX reflection ray
        vec3 H = SampleGGXVNDF(V, roughness, roughness, random.x, random.y);
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
        bool isDiffuseSample = random.z < diffW;
#else
    #ifdef diffuseOnly
        const bool isDiffuseSample = true;
    #else
        const bool isDiffuseSample = false;
    #endif
#endif

        if (isDiffuseSample) {
            l = cosineSampleHemisphere(viewNormal, random.xy);
            h = normalize(v + l);  // half vector

            NoL = clamp(dot(n, l), EPSILON, ONE_MINUS_EPSILON);
            NoH = clamp(dot(n, h), EPSILON, ONE_MINUS_EPSILON);
            LoH = clamp(dot(l, h), EPSILON, ONE_MINUS_EPSILON);
            VoH = clamp(dot(v, h), EPSILON, ONE_MINUS_EPSILON);

            vec3 gi = doSample(
                viewPos, viewDir, viewNormal, worldPos, metalness, roughness, isDiffuseSample, NoV, NoL, NoH, LoH, VoH, random.xy,
                l, hitPos, isMissedRay, brdf);

            gi *= brdf;

            diffuseSamples++;

            diffuseGI = mix(diffuseGI, gi, 1. / diffuseSamples);

        } else {
            vec3 gi = doSample(
                viewPos, viewDir, viewNormal, worldPos, metalness, roughness, isDiffuseSample, NoV, NoL, NoH, LoH, VoH, random.xy,
                l, hitPos, isMissedRay, brdf);

            gi *= brdf;

            specularSamples++;

            specularGI = mix(specularGI, gi, 1. / specularSamples);
        }
    }

#ifndef specularOnly
    gDiffuse = vec4(diffuseGI, roughness);
#endif

#ifndef diffuseOnly
    // calculate world-space ray length used for reprojecting hit points instead of screen-space pixels in the temporal resolve pass
    float rayLength = 0.0;
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
              const float roughness, const bool isDiffuseSample, const float NoV, const float NoL, const float NoH, const float LoH, const float VoH, const vec2 random, inout vec3 l,
              inout vec3 hitPos, out bool isMissedRay, out vec3 brdf) {
    float cosTheta = max(0.0, dot(viewNormal, l));

    if (isDiffuseSample) {
        vec3 diffuseBrdf = vec3(evalDisneyDiffuse(NoL, NoV, LoH, roughness, metalness));
        float pdf = NoL / M_PI;
        pdf = max(EPSILON, pdf);

        brdf = diffuseBrdf / pdf;

        brdf *= cosTheta;

        brdf = clamp(brdf, 0., 1000.);
    } else {
        vec3 specularBrdf = evalDisneySpecular(roughness, NoH, NoV, NoL);
        float pdf = GGXVNDFPdf(NoH, NoV, roughness);
        pdf = max(EPSILON, pdf);

        brdf = specularBrdf / pdf;

        brdf *= cosTheta;

        // clamping it reduces most fireflies
        brdf = clamp(brdf, 0., 50.);
    }

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

        if (!isDiffuseSample) mip *= roughness;

        vec3 sampleDir = reflectedWS.xyz;
        envMapSample = sampleEquirectEnvMapColor(sampleDir, envMap, mip);

        // we won't deal with calculating direct sun light from the env map as it is too noisy
        float envLum = luminance(envMapSample);

        if (envLum > maxEnvLuminance) {
            envMapSample *= maxEnvLuminance / envLum;
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
        vec3 emissiveColor = emissiveTexel.rgb;

        vec3 reprojectedGI = textureLod(accumulatedTexture, reprojectedUv, 0.).rgb;

        SSGI = reprojectedGI + emissiveColor;

#ifdef useDirectLight
        SSGI += textureLod(directLightTexture, coords.xy, 0.).rgb * 3.0;
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

    float depth, unpackedDepth;
    vec2 uv;

    for (int i = 0; i < steps; i++) {
        hitPos += dir;
        if (hitPos.z > 0.0) return INVALID_RAY_COORDS;

        uv = viewSpaceToScreenSpace(hitPos);

#ifndef missedRays
        if (any(lessThan(uv, vec2(0.))) || any(greaterThan(uv, vec2(1.)))) return INVALID_RAY_COORDS;
#endif

        unpackedDepth = unpackRGBAToDepth(textureLod(depthTexture, uv, 0.0));
        depth = fastGetViewZ(unpackedDepth);

        rayHitDepthDifference = depth - hitPos.z;

        if (rayHitDepthDifference >= 0.0 && rayHitDepthDifference < thickness) {
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
    float depth;
    float unpackedDepth;
    vec4 depthTexel;
    float rayHitDepthDifference;
    vec2 uv;

    dir *= 0.5;
    hitPos -= dir;

    for (int i = 0; i < refineSteps; i++) {
        uv = viewSpaceToScreenSpace(hitPos);

        unpackedDepth = unpackRGBAToDepth(textureLod(depthTexture, uv, 0.0));
        depth = fastGetViewZ(unpackedDepth);

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