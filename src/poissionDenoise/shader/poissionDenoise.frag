varying vec2 vUv;

uniform sampler2D inputTexture;
uniform sampler2D depthTexture;
uniform sampler2D normalTexture;
uniform mat4 projectionMatrixInverse;
uniform mat4 cameraMatrixWorld;
uniform float depthPhi;
uniform float normalPhi;
uniform sampler2D blueNoiseTexture;
uniform vec2 blueNoiseRepeat;
uniform int index;
uniform vec2 resolution;

const float g = 1.6180339887498948482;
const float a1 = 1.0 / g;

// reference: https://extremelearning.com.au/unreasonable-effectiveness-of-quasirandom-sequences/
float r1(float n) {
    // 7th harmonious number
    return fract(1.1127756842787055 + a1 * n);
}

const vec4 hn = vec4(0.618033988749895, 0.3247179572447458, 0.2207440846057596, 0.1673039782614187);

vec4 sampleBlueNoise(sampler2D texture, int seed, vec2 repeat, vec2 texSize) {
    vec2 size = vUv * texSize;
    vec2 blueNoiseSize = texSize / repeat;
    float blueNoiseIndex = floor(floor(size.y / blueNoiseSize.y) * repeat.x) + floor(size.x / blueNoiseSize.x);

    // get the offset of this pixel's blue noise tile
    // int blueNoiseTileOffset = int(r1(blueNoiseIndex + 1.0) * 65536.);

    vec2 blueNoiseUv = vUv * repeat;

    // fetch blue noise for this pixel
    vec4 blueNoise = textureLod(texture, blueNoiseUv, 0.);

    // animate blue noise
    blueNoise = fract(blueNoise + hn * float(seed));

    blueNoise.r = (blueNoise.r > 0.5 ? 1.0 - blueNoise.r : blueNoise.r) * 2.0;
    blueNoise.g = (blueNoise.g > 0.5 ? 1.0 - blueNoise.g : blueNoise.g) * 2.0;
    blueNoise.b = (blueNoise.b > 0.5 ? 1.0 - blueNoise.b : blueNoise.b) * 2.0;
    blueNoise.a = (blueNoise.a > 0.5 ? 1.0 - blueNoise.a : blueNoise.a) * 2.0;

    return blueNoise;
}

#include <common>

vec3 getWorldPos(float depth, vec2 coord) {
    float z = depth * 2.0 - 1.0;
    vec4 clipSpacePosition = vec4(coord * 2.0 - 1.0, z, 1.0);
    vec4 viewSpacePosition = projectionMatrixInverse * clipSpacePosition;

    // Perspective division
    vec4 worldSpacePosition = cameraMatrixWorld * viewSpacePosition;
    worldSpacePosition.xyz /= worldSpacePosition.w;
    return worldSpacePosition.xyz;
}

#define luminance(a) dot(vec3(0.2125, 0.7154, 0.0721), a)

vec3 getNormal(vec2 uv, vec4 texel) {
#ifdef NORMAL_IN_RGB
    // in case the normal is stored in the RGB channels of the texture
    return texel.rgb;
#else
    return normalize(textureLod(normalTexture, uv, 0.).xyz * 2.0 - 1.0);
#endif
}

void main() {
    vec4 depthTexel = textureLod(depthTexture, vUv, 0.);

    if (depthTexel.r == 1.0 || dot(depthTexel.rgb, depthTexel.rgb) == 0.) {
        discard;
        return;
    }

    vec4 texel = textureLod(inputTexture, vUv, 0.0);

    vec3 normal = getNormal(vUv, texel);

#ifdef NORMAL_IN_RGB
    float denoised = texel.a;
    float center = texel.a;
#else
    vec3 denoised = texel.rgb;
    float center = texel.rgb;
#endif

    float depth = depthTexel.x;
    vec3 worldPos = getWorldPos(depth, vUv);

    float totalWeight = 1.0;

    vec4 blueNoise = sampleBlueNoise(blueNoiseTexture, 0, blueNoiseRepeat, resolution);
    float angle = blueNoise[index];

    mat2 rotationMatrix = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));

    for (int i = 0; i < samples; i++) {
        vec2 offset = rotationMatrix * poissonDisk[i];
        vec2 neighborUv = vUv + offset;

        vec4 neighborTexel = textureLod(inputTexture, neighborUv, 0.0);

        vec3 neighborNormal = getNormal(neighborUv, neighborTexel);
        float neighborColor = neighborTexel.a;

        float sampleDepth = textureLod(depthTexture, neighborUv, 0.0).x;

        vec3 worldPosSample = getWorldPos(sampleDepth, neighborUv);
        float tangentPlaneDist = abs(dot(worldPos - worldPosSample, normal));

        float normalDiff = dot(normal, neighborNormal);
        float normalSimilarity = pow(max(normalDiff, 0.), normalPhi);

#ifdef NORMAL_IN_RGB
        float lumaDiff = abs(neighborColor - center);
#else
        float lumaDiff = abs(luminance(neighborColor) - luminance(center));
#endif

        float rangeCheck = exp(-1.0 * tangentPlaneDist) * max(normalDiff, 0.5 - 0.5 * lumaDiff);
        float depthSimilarity = rangeCheck / depthPhi;

        float w = depthSimilarity * normalSimilarity;

        denoised += w * neighborColor;
        totalWeight += w;
    }

    if (totalWeight > 0.) denoised /= totalWeight;

#ifdef NORMAL_IN_RGB
    gl_FragColor = vec4(normal, denoised);
#else
    gl_FragColor = vec4(denoised, 1.);
#endif
}