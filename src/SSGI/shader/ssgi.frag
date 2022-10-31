varying vec2 vUv;

uniform sampler2D directLightTexture;
uniform sampler2D accumulatedTexture;
uniform sampler2D normalTexture;
uniform sampler2D depthTexture;
uniform sampler2D diffuseTexture;
uniform sampler2D blueNoiseTexture;
uniform sampler2D velocityTexture;
uniform sampler2D envMap;

uniform mat4 projectionMatrix;
uniform mat4 inverseProjectionMatrix;
uniform mat4 cameraMatrixWorld;
uniform mat4 cameraMatrixWorldInverse;
uniform float cameraNear;
uniform float cameraFar;
uniform float maxEnvMapMipLevel;

uniform float rayDistance;
uniform float maxRoughness;
uniform float ior;
uniform float thickness;
uniform float power;
uniform float intensity;
uniform vec2 invTexSize;
uniform vec2 blueNoiseRepeat;

uniform float samples;
uniform int seed;

uniform float jitter;
uniform float jitterRoughness;

#define INVALID_RAY_COORDS vec2(-1.0);
#define EARLY_OUT_COLOR    vec4(0.0, 0.0, 0.0, 1.0)
#define FLOAT_EPSILON      0.00001
#define TRANSFORM_FACTOR   0.2

float nearMinusFar;
float nearMulFar;
float farMinusNear;

#include <packing>

// helper functions
#include <utils>

vec2 RayMarch(in vec3 dir, inout vec3 hitPos, inout float rayHitDepthDifference);
vec2 BinarySearch(in vec3 dir, inout vec3 hitPos, inout float rayHitDepthDifference);
float fastGetViewZ(const in float depth);
vec3 doSample(vec3 viewPos, vec3 viewDir, vec3 viewNormal, float roughness, float sampleCount, float spread, vec3 Fresnel, inout vec3 reflected);

void main() {
    vec4 depthTexel = textureLod(depthTexture, vUv, 0.0);

    float unpackedDepth = unpackRGBAToDepth(depthTexel);

    // filter out background
    if (dot(depthTexel.rgb, depthTexel.rgb) == 0.) {
        gl_FragColor = EARLY_OUT_COLOR;
        return;
    }

    vec4 normalTexel = textureLod(normalTexture, vUv, 0.0);
    float roughness = normalTexel.a;

    // a roughness of 1 is only being used for deselected meshes
    if (roughness == 1.0 || roughness > maxRoughness) {
        gl_FragColor = EARLY_OUT_COLOR;
        return;
    }

    rng_initialize(vUv, seed);

    // pre-calculated variables for the "fastGetViewZ" function
    nearMinusFar = cameraNear - cameraFar;
    nearMulFar = cameraNear * cameraFar;
    farMinusNear = cameraFar - cameraNear;

    normalTexel.rgb = unpackRGBToNormal(normalTexel.rgb);

    // view-space depth
    float depth = fastGetViewZ(unpackedDepth);

    vec3 worldPos = screenSpaceToWorldSpace(vUv, unpackedDepth);

    // view-space position of the current texel
    vec3 viewPos = getViewPosition(depth);
    vec3 viewDir = normalize(viewPos);
    vec3 viewNormal = normalTexel.xyz;

    float spread = jitter + roughness * jitterRoughness;
    spread = min(1.0, spread);

    float metalness = textureLod(diffuseTexture, vUv, 0.).a;

    vec3 SSGI;
    vec3 diffuseSSGI;
    vec3 specularSSGI;
    vec3 reflected;

    for (int s = 0; s < spp; s++) {
        float sF = float(s);

        diffuseSSGI = doSample(viewPos, viewDir, viewNormal, roughness, sF, 1.0, vec3(1.0), reflected);
        specularSSGI = doSample(viewPos, viewDir, viewNormal, roughness, sF, spread, vec3(1.), reflected);

        float m = 1. / (sF + 1.0);

        float cosTheta = max(dot(viewNormal, reflected), 0.0);
        float fresnelFactor = fresnel_dielectric(viewDir, reflected, ior);

        vec3 gi = mix(diffuseSSGI * (1.0 - metalness), specularSSGI, fresnelFactor);

        SSGI = mix(SSGI, gi, m);
    }

    if (power != 1.0) SSGI = pow(SSGI, vec3(power));

    SSGI *= intensity;

    gl_FragColor = vec4(SSGI, metalness);
}

vec3 doSample(vec3 viewPos, vec3 viewDir, vec3 viewNormal, float roughness, float sampleCount, float spread, vec3 Fresnel, inout vec3 reflected) {
    vec2 startOffset = vec2(sampleCount / float(spp));
    vec2 blueNoiseUv = (vUv + rand2()) * blueNoiseRepeat;
    vec2 random = textureLod(blueNoiseTexture, blueNoiseUv, 0.).rg;

    reflected = spread == 1.0 ? SampleLambert(viewNormal, random) : SampleGGX(viewDir, viewNormal, spread, random);

    if (dot(reflected, viewNormal) < 0.) {
        reflected = SampleGGX(viewDir, viewNormal, spread, vec2(random.y, random.x));
    }

    vec3 SSGI;
    vec3 m = Fresnel * TRANSFORM_FACTOR;

    if (dot(reflected, viewNormal) < 0.) {
        vec4 velocity = textureLod(velocityTexture, vUv, 0.0);
        velocity.xy = unpackRGBATo2Half(velocity) * 2. - 1.;

        vec2 reprojectedUv = vUv - velocity.xy;

        SSGI = textureLod(accumulatedTexture, reprojectedUv, 0.).rgb;
        return m * SSGI;
    }

    vec3 dir = normalize(reflected * -viewPos.z);

    vec3 hitPos = viewPos;
    float rayHitDepthDifference = 0.;

#if steps == 0
    hitPos += dir;

    vec2 coords = viewSpaceToScreenSpace(hitPos);
#else
    vec2 coords = RayMarch(dir, hitPos, rayHitDepthDifference);
#endif

    bool isAllowedMissedRay = rayHitDepthDifference == -1.0;
    bool isInvalidRay = coords.x == -1.0;

    vec3 envMapSample = vec3(0.);

#ifdef USE_ENVMAP
    // invalid ray, use environment lighting as fallback
    if (isInvalidRay || isAllowedMissedRay) {
        // world-space reflected ray
        vec4 reflectedWS = vec4(reflected, 1.) * cameraMatrixWorldInverse;
        reflectedWS.xyz = normalize(reflectedWS.xyz);

    #ifdef BOX_PROJECTED_ENV_MAP
        float depth = unpackRGBAToDepth(textureLod(depthTexture, vUv, 0.));
        vec3 worldPosition = screenSpaceToWorldSpace(vUv, depth);
        reflectedWS.xyz = parallaxCorrectNormal(reflectedWS.xyz, envMapSize, envMapPosition, worldPosition);
        reflectedWS.xyz = normalize(reflectedWS.xyz);
    #endif

        float mip = 8. / 13. * maxEnvMapMipLevel * spread;

        vec3 sampleDir = reflectedWS.xyz;
        envMapSample = sampleEquirectEnvMapColor(sampleDir, envMap, mip);

        // we won't deal with calculating direct sun light from the env map as it is too noisy
        if (dot(envMapSample, envMapSample) > 3.) envMapSample = vec3(1.);

        if (!isAllowedMissedRay) return m * envMapSample;
    }
#endif

    vec2 dCoords = smoothstep(0.2, 0.6, abs(vec2(0.5, 0.5) - vUv));
    float ssgiIntensity = clamp(1.0 - (dCoords.x + dCoords.y), 0.0, 1.0);
    m *= ssgiIntensity;

    // reproject the coords from the last frame
    vec4 velocity = textureLod(velocityTexture, coords.xy, 0.0);
    velocity.xy = unpackRGBATo2Half(velocity) * 2. - 1.;

    vec2 reprojectedUv = coords.xy - velocity.xy;

    // check if the reprojected coordinates are within the screen
    if (all(greaterThanEqual(reprojectedUv, vec2(0.))) && all(lessThanEqual(reprojectedUv, vec2(1.)))) {
        SSGI = textureLod(accumulatedTexture, reprojectedUv, 0.).rgb + textureLod(directLightTexture, reprojectedUv, 0.).rgb;
    } else {
        SSGI = textureLod(directLightTexture, vUv, 0.).rgb;
    }

    if (isAllowedMissedRay) {
        float ssgiLum = czm_luminance(SSGI);
        float envLum = czm_luminance(envMapSample);

        if (envLum > ssgiLum) SSGI = envMapSample;
    }

    return m * SSGI;
}

vec2 RayMarch(in vec3 dir, inout vec3 hitPos, inout float rayHitDepthDifference) {
    float stepsFloat = float(steps);

    dir *= rayDistance / float(steps);

    float depth;
    float unpackedDepth;
    vec2 uv;

    for (int i = 1; i <= steps; i++) {
        hitPos += dir;
        uv = viewSpaceToScreenSpace(hitPos);

        unpackedDepth = unpackRGBAToDepth(textureLod(depthTexture, uv, 2.0));
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

#ifndef missedRays
    return INVALID_RAY_COORDS;
#endif

    rayHitDepthDifference = -1.0;

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