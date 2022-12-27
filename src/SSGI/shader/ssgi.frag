layout(location = 0) out vec4 gSSGI;
layout(location = 1) out vec4 gBRDF;

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
uniform mat4 _viewMatrix;
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
uniform int seed;
uniform vec2 blueNoiseOffset;

uniform float jitter;
uniform float jitterRoughness;

#define INVALID_RAY_COORDS vec2(-1.0);
#define EARLY_OUT_COLOR    vec4(0.0, 0.0, 0.0, 0.0)
#define FLOAT_EPSILON      0.00001

float nearMinusFar;
float nearMulFar;
float farMinusNear;

#include <packing>

// helper functions
#include <utils>

vec2 RayMarch(in vec3 dir, inout vec3 hitPos, inout float rayHitDepthDifference);
vec2 BinarySearch(in vec3 dir, inout vec3 hitPos, inout float rayHitDepthDifference);
float fastGetViewZ(const in float depth);
vec3 doSample(vec3 viewPos, vec3 viewDir, vec3 viewNormal, vec3 worldPosition, float metalness, float spread, bool isDiffuseSample, vec3 F, vec2 random, inout vec3 reflected, inout vec3 hitPos, out bool isMissedRay, out vec3 brdf);
void main() {
    vec4 depthTexel = textureLod(depthTexture, vUv, 0.0);

    float unpackedDepth = unpackRGBAToDepth(depthTexel);

    // filter out background
    if (dot(depthTexel.rgb, depthTexel.rgb) == 0.) {
        gSSGI = gBRDF = EARLY_OUT_COLOR;
        return;
    }

    vec4 normalTexel = textureLod(normalTexture, vUv, 0.0);
    float roughness = normalTexel.a;

    // a roughness of 1 is only being used for deselected meshes
    if (roughness == 1.0 || roughness > maxRoughness) {
        gSSGI = gBRDF = EARLY_OUT_COLOR;
        return;
    }

    normalTexel.xyz = unpackRGBToNormal(normalTexel.rgb);

    rng_initialize(vec2(0.), seed);

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

    vec3 worldPos = vec4(_viewMatrix * vec4(viewPos, 1.)).xyz;

    float spread = jitter + roughness * jitterRoughness;
    spread = clamp(spread, 0.001, 1.0);

    vec4 diffuseTexel = textureLod(diffuseTexture, vUv, 0.);
    vec3 diffuse = diffuseTexel.rgb;
    float metalness = diffuseTexel.a;

    vec3 SSGI;
    vec3 reflected;
    vec3 hitPos;
    vec2 sampleOffset;

    bool isMissedRay = false;
    bool isDiffuseSample = false;

    vec3 brdf = vec3(1.0);

    for (int s = 0; s < 1; s++) {
        sampleOffset = rand2();

        float sF = float(s);
        float m = 1. / (sF + 1.0);

        vec2 blueNoiseUv = (vUv + blueNoiseOffset + sampleOffset) * blueNoiseRepeat;
        vec3 random = textureLod(blueNoiseTexture, blueNoiseUv, 0.).rgb;

        vec3 gi;
        {
            // convert view dir and view normal to world-space
            vec3 V = -(vec4(viewDir, 1.) * _viewMatrix).xyz;  // invert view dir
            vec3 N = (vec4(viewNormal, 1.) * _viewMatrix).xyz;

            vec3 T, B;
            Onb(N, T, B);

            V = ToLocal(T, B, N, V);

            float spr = max(0.01, spread);

            vec3 H = SampleGGXVNDF(V, spr, spr, random.x, random.y);

            if (H.z < 0.0)
                H = -H;

            reflected = normalize(reflect(-V, H));
            reflected = ToWorld(T, B, N, reflected);

            // convert reflected vector back to view-space
            reflected = (vec4(reflected, 1.) * cameraMatrixWorld).xyz;
            reflected = normalize(reflected);
        }

        if (dot(viewNormal, reflected) < 0.) reflected = -reflected;

        vec3 n = viewNormal;
        vec3 v = -viewDir;
        vec3 l = reflected;
        vec3 h = normalize(v + l);

        float NoL = max(FLOAT_EPSILON, dot(n, l));
        float NoV = max(FLOAT_EPSILON, dot(n, v));
        float NoH = max(FLOAT_EPSILON, dot(n, h));
        float LoH = max(FLOAT_EPSILON, dot(l, h));
        float VoH = max(FLOAT_EPSILON, dot(v, h));

        // fresnel
        vec3 f0 = mix(vec3(0.04), diffuse, metalness);
        vec3 F = F_Schlick(f0, VoH);

        float diffW = (1. - metalness) * czm_luminance(diffuse);
        float specW = czm_luminance(F);
        float invW = 1. / (diffW + specW);
        diffW *= invW;
        specW *= invW;

        diffW = max(diffW, FLOAT_EPSILON);
        specW = max(specW, FLOAT_EPSILON);

        isDiffuseSample = random.z < diffW;

        if (isDiffuseSample) {
            reflected = cosineSampleHemisphere(viewNormal, random.xy);
            gi = doSample(viewPos, viewDir, viewNormal, worldPos, metalness, spread, isDiffuseSample, F, random.xy, reflected, hitPos, isMissedRay, brdf);
            brdf /= diffW;
            brdf *= 1. - metalness;
            brdf *= diffuse;
        } else {
            gi = doSample(viewPos, viewDir, viewNormal, worldPos, metalness, spread, isDiffuseSample, F, random.xy, reflected, hitPos, isMissedRay, brdf);

            brdf /= specW;
        }

        float cosTheta = max(FLOAT_EPSILON, dot(viewNormal, reflected));
        brdf *= cosTheta;

        gi *= brdf;

        SSGI = mix(SSGI, gi, m);
    }

    float rayLength = 0.0;
    if (!isMissedRay && spread < 0.675) {
        vec3 normalWS = (vec4(viewNormal, 1.) * _viewMatrix).xyz;

        vec3 dx = dFdx(normalWS);
        vec3 dy = dFdy(normalWS);

        float x = dot(dx, dx);
        float y = dot(dy, dy);

        float curvature = sqrt(x * x + y * y);

        if (curvature < 0.05) {
            vec3 hitPosWS = (_viewMatrix * vec4(hitPos, 1.)).xyz;
            rayLength = distance(worldPos, hitPosWS);
        }
    }

    float a = 0.;

    gSSGI = vec4(SSGI, rayLength);
    gBRDF = vec4(brdf, a);
}

vec3 doSample(vec3 viewPos, vec3 viewDir, vec3 viewNormal, vec3 worldPosition, float metalness, float spread, bool isDiffuseSample, vec3 F, vec2 random, inout vec3 reflected, inout vec3 hitPos, out bool isMissedRay, out vec3 brdf) {
    // todo: check why sqrt?
    if (!isDiffuseSample) {
        spread = sqrt(spread);
    }

    vec3 SSGI;

    vec3 n = viewNormal;
    vec3 v = -viewDir;
    vec3 l = reflected;
    vec3 h = normalize(v + l);

    float NoL = max(FLOAT_EPSILON, dot(n, l));
    float NoV = max(FLOAT_EPSILON, dot(n, v));
    float NoH = max(FLOAT_EPSILON, dot(n, h));
    float LoH = max(FLOAT_EPSILON, dot(l, h));
    float VoH = max(FLOAT_EPSILON, dot(v, h));

    vec4 diffuseTexel = textureLod(diffuseTexture, vUv, 0.);

    if (isDiffuseSample) {
        vec3 diffuseBrdf = evalDisneyDiffuse(NoL, NoV, LoH, spread, diffuseTexel.a) * (1. - F);
        float pdf = NoL / M_PI;

        brdf *= diffuseBrdf / pdf;
    } else {
        vec3 specularBrdf = evalDisneySpecular(spread, F, NoH, NoV, NoL);
        float pdf = GGXVNDFPdf(NoH, NoV, spread);

        pdf = clamp(pdf, FLOAT_EPSILON, 100.);
        specularBrdf = clamp(specularBrdf, FLOAT_EPSILON, 100.);

        brdf *= specularBrdf / pdf;
    }

    hitPos = viewPos;
    float rayHitDepthDifference = 0.;

#if steps == 0
    hitPos += reflected;

    vec2 coords = viewSpaceToScreenSpace(hitPos);
#else
    vec2 coords = RayMarch(reflected, hitPos, rayHitDepthDifference);
#endif

    bool allowMissedRays = false;
#ifdef missedRays
    allowMissedRays = true;
#endif

    isMissedRay = rayHitDepthDifference == -1.0;
    bool isAllowedMissedRay = allowMissedRays && isMissedRay;
    bool isInvalidRay = coords.x == -1.0;

    vec3 envMapSample = vec3(0.);

#ifdef USE_ENVMAP
    // invalid ray, use environment lighting as fallback
    if (isInvalidRay || isAllowedMissedRay) {
        // world-space reflected ray
        vec4 reflectedWS = vec4(reflected, 1.) * _viewMatrix;
        reflectedWS.xyz = normalize(reflectedWS.xyz);

    #ifdef BOX_PROJECTED_ENV_MAP
        float depth = unpackRGBAToDepth(textureLod(depthTexture, vUv, 0.));
        reflectedWS.xyz = parallaxCorrectNormal(reflectedWS.xyz, envMapSize, envMapPosition, worldPosition);
        reflectedWS.xyz = normalize(reflectedWS.xyz);
    #endif

        // float mip = spread == 1.0 ? 7. / 13. * maxEnvMapMipLevel * spread * spread : 0.0;

        vec3 sampleDir = reflectedWS.xyz;
        envMapSample = sampleEquirectEnvMapColor(sampleDir, envMap, 0.);

        // we won't deal with calculating direct sun light from the env map as it is too noisy
        float envLum = czm_luminance(envMapSample);

        const float maxVal = 10.0;
        if (envLum > maxVal) envMapSample *= maxVal / envLum;

        return envMapSample;
    }
#endif

    // reproject the coords from the last frame
    vec4 velocity = textureLod(velocityTexture, coords.xy, 0.0);
    velocity.xy = unpackRGBATo2Half(velocity) * 2. - 1.;

    vec2 reprojectedUv = coords.xy - velocity.xy;

    // check if the reprojected coordinates are within the screen
    if (all(greaterThanEqual(reprojectedUv, vec2(0.))) && all(lessThanEqual(reprojectedUv, vec2(1.)))) {
        vec4 emissiveTexel = textureLod(emissiveTexture, coords.xy, 0.);
        vec3 emissiveColor = emissiveTexel.rgb;
        float emissiveIntensity = emissiveTexel.a * 10.0;

        SSGI = textureLod(accumulatedTexture, reprojectedUv, 0.).rgb + emissiveColor * emissiveIntensity;
    } else {
        SSGI = textureLod(directLightTexture, vUv, 0.).rgb;
    }

    float ssgiLum = czm_luminance(SSGI);

    if (isAllowedMissedRay) {
        float envLum = czm_luminance(envMapSample);

        if (envLum > ssgiLum) SSGI = envMapSample;
    } else {
        vec2 dCoords = smoothstep(0.2, 0.6, abs(vec2(0.5, 0.5) - vUv));
        float screenEdgeIntensity = clamp(1.0 - (dCoords.x + dCoords.y), 0.0, 1.0);

        brdf *= screenEdgeIntensity;
    }

    return SSGI;
}

vec2 RayMarch(in vec3 dir, inout vec3 hitPos, inout float rayHitDepthDifference) {
    float stepsFloat = float(steps);

    dir *= rayDistance / float(steps);

    float depth;
    float unpackedDepth;
    vec2 uv;

    for (int i = 0; i < steps; i++) {
        hitPos += dir;
        if (hitPos.z > 0.0) return INVALID_RAY_COORDS;

        uv = viewSpaceToScreenSpace(hitPos);

        unpackedDepth = unpackRGBAToDepth(textureLod(depthTexture, uv, 0.0));
        depth = fastGetViewZ(unpackedDepth);

        rayHitDepthDifference = depth - hitPos.z;

        if (rayHitDepthDifference >= 0.0 && rayHitDepthDifference < thickness) {
#if refineSteps == 0
            rayHitDepthDifference = unpackedDepth;

            return uv;
#else
            return BinarySearch(dir, hitPos, rayHitDepthDifference);
#endif
        }
    }

    rayHitDepthDifference = -1.0;

#ifndef missedRays
    return INVALID_RAY_COORDS;
#endif

    return uv;
}

vec2 BinarySearch(in vec3 dir, inout vec3 hitPos, inout float rayHitDepthDifference) {
    float depth;
    float unpackedDepth;
    vec4 depthTexel;
    vec2 uv;

    dir *= 0.5;
    hitPos += rayHitDepthDifference > 0.0 ? -dir : dir;

    for (int i = 0; i < refineSteps; i++) {
        uv = viewSpaceToScreenSpace(hitPos);

        unpackedDepth = unpackRGBAToDepth(textureLod(depthTexture, uv, 0.0));
        depth = fastGetViewZ(unpackedDepth);

        rayHitDepthDifference = depth - hitPos.z;

        dir *= 0.5;
        hitPos += rayHitDepthDifference > 0.0 ? -dir : dir;
    }

    uv = viewSpaceToScreenSpace(hitPos);

    rayHitDepthDifference = unpackedDepth;

    return uv;
}

// source: https://github.com/mrdoob/three.js/blob/342946c8392639028da439b6dc0597e58209c696/examples/js/shaders/SAOShader.js#L123
float fastGetViewZ(const in float depth) {
#ifdef PERSPECTIVE_CAMERA
    return nearMulFar / (farMinusNear * depth - cameraFar);
#else
    return depth * nearMinusFar - cameraNear;
#endif
}