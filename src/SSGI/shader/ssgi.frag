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
vec3 doSample(vec3 viewPos, vec3 viewDir, vec3 viewNormal, vec3 worldPosition, float metalness, float spread, vec2 sampleOffset, inout vec3 reflected, inout vec3 hitPos, out bool isMissedRay);

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
    spread = min(1.0, spread);

    vec4 diffuseTexel = textureLod(diffuseTexture, vUv, 0.);
    vec3 diffuse = diffuseTexel.rgb;
    float metalness = diffuseTexel.a;

    vec3 SSGI;
    vec3 reflected;
    vec3 hitPos;
    vec2 sampleOffset;

    bool isMissedRay = false;

    float ior = mix(2., 3.0, min(1., spread * 2.));
    float fresnelFactor = fresnel_dielectric(viewDir, viewNormal, ior);
    float metalFresnel = fresnel_dielectric(viewDir, viewNormal, 1.5);
    float diffuseFactor = 1. - metalness * (1. - spread * 0.5);
    float specularFactor = mix(fresnelFactor, 1., spread) * (1. - spread * 0.75) + metalFresnel * (1. - spread) * 0.75;

    for (int s = 0; s < spp; s++) {
        sampleOffset = rand2();

        float sF = float(s);
        float m = 1. / (sF + 1.0);

        vec3 gi;
        vec2 blueNoiseUv = (vUv + blueNoiseOffset) * blueNoiseRepeat;
        if (false && textureLod(blueNoiseTexture, blueNoiseUv, 0.).rg.x > 1. - metalness) {
            gi = doSample(viewPos, viewDir, viewNormal, worldPos, metalness, 1.0, sampleOffset, reflected, hitPos, isMissedRay);

        } else {
            gi = doSample(viewPos, viewDir, viewNormal, worldPos, metalness, spread, sampleOffset, reflected, hitPos, isMissedRay);
            // gi += gi * metalFresnel * 20. * (1. - spread);
        }

        // vec3 gi = diffuseSSGI * diffuseFactor + specularSSGI * specularFactor;

        SSGI = mix(SSGI, gi, m);
    }

    float rayLength = 0.0;
    if (!isMissedRay && spread < 0.675) {
        vec3 normalWS = viewNormal * mat3(_viewMatrix);

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

    gl_FragColor = vec4(SSGI, rayLength);
}

vec3 doSample(vec3 viewPos, vec3 viewDir, vec3 viewNormal, vec3 worldPosition, float metalness, float spread, vec2 sampleOffset, inout vec3 reflected, inout vec3 hitPos, out bool isMissedRay) {
    vec2 blueNoiseUv = (vUv + blueNoiseOffset + sampleOffset) * blueNoiseRepeat;
    vec2 random = textureLod(blueNoiseTexture, blueNoiseUv, 0.).rg;

    spread = sqrt(spread);
    if (spread < 0.01) spread = 0.01;

    bool isHemisphereSample = spread == 1.0;

    reflected = isHemisphereSample ? SampleLambert(viewNormal, random) : SampleGGX(viewDir, viewNormal, spread, random);

    if (dot(reflected, viewNormal) < 0.) {
        reflected = -reflected;
    }

    vec3 SSGI;
    vec3 m = vec3(1.0);
    m *= max(0.001, dot(reflected, viewNormal));

    vec3 n = viewNormal;
    vec3 v = -viewDir;
    vec3 l = reflected;
    vec3 h = normalize(v + l);

    float NoL = max(0.001, dot(n, l));
    float NoV = max(0.001, dot(n, v));
    float NoH = max(0.001, dot(n, h));
    float LoH = max(0.001, dot(l, h));
    float VoH = max(0.001, dot(v, h));

    vec4 diffuseTexel = textureLod(diffuseTexture, vUv, 0.);

    vec3 f0 = mix(vec3(0.04), diffuseTexel.rgb, diffuseTexel.a);
    vec3 F = F_Schlick(f0, VoH);

    // m *= F;

    vec3 brdf = evalDisneySpecular(spread, F, NoH, NoV, NoL);
    float pdf = GGXVNDFPdf(NoH, NoV, spread);

    pdf = clamp(pdf, 0.0001, 100.);
    brdf = clamp(brdf, 0.0001, 100.);

    m *= brdf;
    m /= pdf;

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

        float mip = spread == 1.0 ? 0. : 7. / 13. * maxEnvMapMipLevel * spread * spread;

        vec3 sampleDir = reflectedWS.xyz;
        envMapSample = sampleEquirectEnvMapColor(sampleDir, envMap, mip);

        // we won't deal with calculating direct sun light from the env map as it is too noisy
        float envLum = czm_luminance(envMapSample);

        const float maxVal = 10.0;
        if (envLum > maxVal) envMapSample *= maxVal / envLum;

        return m * envMapSample;
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

        m *= screenEdgeIntensity;
    }

    return m * SSGI;
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