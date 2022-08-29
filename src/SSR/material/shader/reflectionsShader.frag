varying vec2 vUv;

// precision lowp float;

uniform sampler2D inputTexture;
uniform sampler2D accumulatedTexture;
uniform sampler2D normalTexture;
uniform sampler2D depthTexture;
uniform sampler2D diffuseTexture;
uniform sampler2D fullResDepthTexture;
uniform sampler2D envMap;

uniform mat4 _projectionMatrix;
uniform mat4 _inverseProjectionMatrix;
uniform mat4 cameraMatrixWorld;
uniform float cameraNear;
uniform float cameraFar;

uniform float rayDistance;
uniform float maxDepthDifference;
uniform float roughnessFade;
uniform float maxRoughness;
uniform float fade;
uniform float thickness;
uniform float ior;
uniform vec2 invTexSize;

uniform float samples;
uniform float exponent;

uniform float jitter;
uniform float jitterRoughness;

#define INVALID_RAY_COORDS      vec2(-1.0);
#define EARLY_OUT_COLOR         vec4(0.0, 0.0, 0.0, 1.0)
#define FLOAT_EPSILON           0.00001
#define FLOAT_ONE_MINUS_EPSILON 0.99999
#define TWO_PI                  6.283185307179586
#define USE_DIFFUSE

float nearMinusFar;
float nearMulFar;
float farMinusNear;

#include <packing>

// helper functions
#include <helperFunctions>

vec2 RayMarch(vec3 dir, inout vec3 hitPos, inout float rayHitDepthDifference);
vec2 BinarySearch(in vec3 dir, inout vec3 hitPos, inout float rayHitDepthDifference);
float fastGetViewZ(const in float depth);
vec3 getIBLRadiance(const in vec3 viewDir, const in vec3 normal, const in float roughness);
vec4 doSample(vec3 viewPos, vec3 viewDir, vec3 viewNormal, float roughness, float lastFrameAlpha, float sampleCount, vec3 worldPos, float spread);

vec2 hash23(vec3 p3) {
    p3 = fract(p3 * vec3(.1031, .1030, .0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
}

// source: https://github.com/CesiumGS/cesium/blob/main/Source/Shaders/Builtin/Functions/luminance.glsl
float czm_luminance(vec3 rgb) {
    // Algorithm from Chapter 10 of Graphics Shaders.
    const vec3 W = vec3(0.2125, 0.7154, 0.0721);
    return dot(rgb, W);
}

vec3 czm_saturation(vec3 rgb, float adjustment) {
    // Algorithm from Chapter 16 of OpenGL Shading Language
    const vec3 W = vec3(0.2125, 0.7154, 0.0721);
    vec3 intensity = vec3(dot(rgb, W));
    return mix(intensity, rgb, adjustment);
}

void main() {
    vec4 depthTexel = textureLod(depthTexture, vUv, 0.0);

    // filter out sky
    if (dot(depthTexel.rgb, depthTexel.rgb) < FLOAT_EPSILON) {
        gl_FragColor = EARLY_OUT_COLOR;
        return;
    }

    float unpackedDepth = unpackRGBAToDepth(depthTexel);

    vec4 normalTexel = textureLod(normalTexture, vUv, 0.0);
    float roughness = normalTexel.a;

    float specular = 1.0 - roughness;

    // pre-calculated variables for the "fastGetViewZ" function
    nearMinusFar = cameraNear - cameraFar;
    nearMulFar = cameraNear * cameraFar;
    farMinusNear = cameraFar - cameraNear;

    normalTexel.rgb = unpackRGBToNormal(normalTexel.rgb);

    // view-space depth
    float depth = fastGetViewZ(unpackedDepth);

    float lastFrameAlpha = textureLod(accumulatedTexture, vUv, 0.0).a;
    vec3 worldPos = screenSpaceToWorldSpace(vUv, unpackedDepth);

    // view-space position of the current texel
    vec3 viewPos = getViewPosition(depth);
    vec3 viewDir = normalize(viewPos);
    vec3 viewNormal = normalTexel.xyz;

    if (roughness > maxRoughness || (roughness > 1.0 - FLOAT_EPSILON && roughnessFade > 1.0 - FLOAT_EPSILON)) {
        float fresnelFactor = fresnel_dielectric(viewDir, viewNormal, ior);
        vec3 iblRadiance = getIBLRadiance(-viewDir, viewNormal, roughness) * fresnelFactor;
        iblRadiance = clamp(iblRadiance, vec3(0.0), vec3(1.0));
        gl_FragColor = vec4(iblRadiance, lastFrameAlpha);
        return;
    }

    vec3 ssrCol;

    int iterations = (jitter == 0.0 && roughness < 0.05) ? 1 : spp;

    // if (lastFrameAlpha <= 0.05) iterations += 4;

    // if (lastFrameAlpha > FLOAT_ONE_MINUS_EPSILON) iterations = 1;

    float weight = 1.0 / float(iterations);

    float spread = jitter + roughness * jitterRoughness;
    spread *= 2.;
    // spread = min(1.0, spread);

    for (int s = 0; s <= iterations; s++) {
        float sF = float(s);
        vec4 SSR = doSample(viewPos, viewDir, viewNormal, roughness, lastFrameAlpha, sF, worldPos, spread);
        float m = 1. / (sF + 1.);

        ssrCol = mix(ssrCol, SSR.xyz, weight);
    }

    float roughnessFactor = mix(specular, 1.0, max(0.0, 1.0 - roughnessFade));

    vec3 finalSSR = ssrCol * roughnessFactor;
    finalSSR = clamp(finalSSR, vec3(0.0), vec3(1.0));

    float alpha = lastFrameAlpha;

    // this reduces the smearing on mirror-like or glossy surfaces when the camera moves
    // if (samples < 2. && spread < 0.5) alpha = min(lastFrameAlpha, spread * 0.25);

    gl_FragColor = vec4(finalSSR, alpha);
}

vec4 doSample(vec3 viewPos, vec3 viewDir, vec3 viewNormal, float roughness, float lastFrameAlpha, float sampleCount, vec3 worldPos, float spread) {
    // jittering
    if (jitterRoughness != 0.0 || jitter != 0.0) {
        float ind = log(samples * float(spp) + sampleCount);

        vec3 seed = 1500.0 * ind * worldPos + ind;

        vec2 random = hash23(seed);
        float r1 = random.x;
        float r2 = random.y;

        float x = cos(TWO_PI * r1) * 2. * sqrt(r2 * (1.0 - r2));
        float y = sin(TWO_PI * r1) * 2. * sqrt(r2 * (1.0 - r2));
        float z = 1. - 2. * r2;

        vec3 randomJitter = vec3(x, y, z);
        viewNormal += randomJitter * spread;
    }

    float fresnelFactor = fresnel_dielectric(viewDir, viewNormal, ior);

    vec3 iblRadiance = vec3(0.);

    // view-space reflected ray
    vec3 reflected = normalize(reflect(viewDir, viewNormal));

    vec3 dir = reflected * -viewPos.z;
    dir = normalize(dir);
    dir *= rayDistance / float(steps);

    vec3 hitPos = viewPos;
    float rayHitDepthDifference;

#if steps == 0
    hitPos += dir;

    vec4 projectedCoord = _projectionMatrix * vec4(hitPos, 1.0);
    projectedCoord.xy /= projectedCoord.w;
    // [-1, 1] --> [0, 1] (NDC to screen position)
    projectedCoord.xy = projectedCoord.xy * 0.5 + 0.5;

    // the ray is outside the camera's frustum
    if (projectedCoord.x < 0.0 || projectedCoord.x > 1.0 || projectedCoord.y < 0.0 || projectedCoord.y > 1.0) {
        projectedCoord.xy = INVALID_RAY_COORDS;
    }

    vec2 coords = projectedCoord.xy;
#else
    vec2 coords = RayMarch(dir, hitPos, rayHitDepthDifference);
#endif

    // invalid ray
    if (coords.x == -1.0) {
        iblRadiance = getIBLRadiance(-viewDir, viewNormal, 0.) * fresnelFactor;
        iblRadiance = clamp(iblRadiance, vec3(0.0), vec3(1.0));

#ifdef USE_DIFFUSE
        vec4 diffuseTexel = textureLod(diffuseTexture, vUv, 0.);
        diffuseTexel.rgb = czm_saturation(diffuseTexel.rgb, 0.5);

        iblRadiance *= diffuseTexel.rgb + 0.05;
#endif

        return vec4(iblRadiance, lastFrameAlpha);
    }

    vec2 dCoords = smoothstep(0.2, 0.6, abs(vec2(0.5, 0.5) - coords.xy));
    float reflectionIntensity = clamp(1.0 - (dCoords.x + dCoords.y), 0.0, 1.0);

    vec3 hitWorldPos = screenSpaceToWorldSpace(coords, rayHitDepthDifference);

    // distance from the reflection point to what it's reflecting
    float reflectionDistance = distance(hitWorldPos, worldPos);

    float lod = min(8., log(reflectionDistance) * 10.0 * spread);
    vec4 SSRTexel = textureLod(inputTexture, coords.xy, lod);

    vec4 SSRTexelReflected = textureLod(accumulatedTexture, coords.xy, lod);

#ifdef USE_DIFFUSE
    vec4 diffuseTexel = textureLod(diffuseTexture, coords.xy, lod);
    SSRTexel.rgb *= diffuseTexel.rgb + 0.05;
#endif

    vec3 SSR = SSRTexel.rgb + SSRTexelReflected.rgb;

    vec3 finalSSR = vec3(0.);

    if (reflectionIntensity > FLOAT_ONE_MINUS_EPSILON) {
        finalSSR = SSR;
    } else {
        iblRadiance = getIBLRadiance(-viewDir, viewNormal, spread) * fresnelFactor;
        iblRadiance = clamp(iblRadiance, vec3(0.0), vec3(1.0));
        finalSSR = mix(iblRadiance, SSR, reflectionIntensity);
    }

    finalSSR = SSR;

    if (fade != 0.0) {
        float opacity = 1.0 / ((reflectionDistance + 1.0) * fade * 0.1);
        if (opacity > 1.0) opacity = 1.0;
        finalSSR *= opacity;
    }

    finalSSR *= fresnelFactor;
    finalSSR = min(vec3(1.0), finalSSR);

    // finalSSR = vec3(floor(lod) / 8.);

    return vec4(finalSSR, SSRTexelReflected.a);
}

vec2 RayMarch(vec3 dir, inout vec3 hitPos, inout float rayHitDepthDifference) {
    float depth;
    vec4 projectedCoord;
    float unpackedDepth;
    vec4 depthTexel;

    for (int i = 0; i < steps; i++) {
        hitPos += dir;

        projectedCoord = _projectionMatrix * vec4(hitPos, 1.0);
        projectedCoord.xy /= projectedCoord.w;
        // [-1, 1] --> [0, 1] (NDC to screen position)
        projectedCoord.xy = projectedCoord.xy * 0.5 + 0.5;

        // the ray is outside the camera's frustum
        if (projectedCoord.x < 0.0 || projectedCoord.x > 1.0 || projectedCoord.y < 0.0 || projectedCoord.y > 1.0) {
            return INVALID_RAY_COORDS;
        }

        depthTexel = textureLod(depthTexture, projectedCoord.xy, 0.0);

        unpackedDepth = unpackRGBAToDepth(depthTexel);

        depth = fastGetViewZ(unpackedDepth);

        rayHitDepthDifference = depth - hitPos.z;

        if (rayHitDepthDifference >= 0.0 && rayHitDepthDifference < thickness) {
#if refineSteps == 0
            rayHitDepthDifference = unpackedDepth;

            return projectedCoord.xy;
#else
            return BinarySearch(dir, hitPos, rayHitDepthDifference);
#endif
        }

        // the ray is behind the camera
        if (hitPos.z > 0.0) {
            return INVALID_RAY_COORDS;
        }
    }

    // since hitPos isn't used anywhere we can use it to mark that this reflection would have been invalid
    hitPos.z = 1.0;

#ifndef missedRays
    return INVALID_RAY_COORDS;
#endif

    rayHitDepthDifference = unpackedDepth;

    return projectedCoord.xy;
}

vec2 BinarySearch(in vec3 dir, inout vec3 hitPos, inout float rayHitDepthDifference) {
    float depth;
    vec4 projectedCoord;
    vec2 lastMinProjectedCoordXY;
    float unpackedDepth;
    vec4 depthTexel;

    for (int i = 0; i < refineSteps; i++) {
        projectedCoord = _projectionMatrix * vec4(hitPos, 1.0);
        projectedCoord.xy /= projectedCoord.w;
        projectedCoord.xy = projectedCoord.xy * 0.5 + 0.5;

        depthTexel = textureLod(fullResDepthTexture, projectedCoord.xy, 0.0);

        unpackedDepth = unpackRGBAToDepth(depthTexel);
        depth = fastGetViewZ(unpackedDepth);

        rayHitDepthDifference = depth - hitPos.z;

        dir *= 0.5;

        if (rayHitDepthDifference > 0.0) {
            hitPos -= dir;
        } else {
            hitPos += dir;
        }
    }

    // filter out sky
    if (dot(depthTexel.rgb, depthTexel.rgb) < FLOAT_EPSILON) return INVALID_RAY_COORDS;

    if (abs(rayHitDepthDifference) > maxDepthDifference) return INVALID_RAY_COORDS;

    projectedCoord = _projectionMatrix * vec4(hitPos, 1.0);
    projectedCoord.xy /= projectedCoord.w;
    projectedCoord.xy = projectedCoord.xy * 0.5 + 0.5;

    rayHitDepthDifference = unpackedDepth;

    return projectedCoord.xy;
}

// source: https://github.com/mrdoob/three.js/blob/342946c8392639028da439b6dc0597e58209c696/examples/js/shaders/SAOShader.js#L123
float fastGetViewZ(const in float depth) {
#ifdef PERSPECTIVE_CAMERA
    return nearMulFar / (farMinusNear * depth - cameraFar);
#else
    return depth * nearMinusFar - cameraNear;
#endif
}

#include <common>
#include <cube_uv_reflection_fragment>

// from: https://github.com/mrdoob/three.js/blob/d5b82d2ca410e2e24ca2f7320212dfbee0fe8e89/src/renderers/shaders/ShaderChunk/envmap_physical_pars_fragment.glsl.js#L22
vec3 getIBLRadiance(const in vec3 viewDir, const in vec3 normal, const in float roughness) {
#if defined(ENVMAP_TYPE_CUBE_UV)
    vec3 reflectVec = reflect(-viewDir, normal);

    // Mixing the reflection with the normal is more accurate and keeps rough objects from gathering light from behind their tangent plane.
    // reflectVec = normalize(mix(reflectVec, normal, roughness * roughness));
    reflectVec = inverseTransformDirection(reflectVec, viewMatrix);

    vec4 envMapColor = textureCubeUV(envMap, reflectVec, min(0.2, roughness));
    return envMapColor.rgb;
#else
    return vec3(0.0);
#endif
}