varying vec2 vUv;

uniform sampler2D inputTexture;
uniform sampler2D inputTexture2;
uniform sampler2D depthTexture;
uniform sampler2D directLightTexture;
uniform mat4 projectionMatrixInverse;
uniform mat4 projectionMatrix;
uniform mat4 cameraMatrixWorld;
uniform float lumaPhi;
uniform float depthPhi;
uniform float normalPhi;
uniform float roughnessPhi;
uniform float diffusePhi;
uniform sampler2D blueNoiseTexture;
uniform vec2 blueNoiseRepeat;
uniform int index;
uniform vec2 resolution;
uniform bool isLastIteration;

layout(location = 0) out vec4 gOutput0;
layout(location = 1) out vec4 gOutput1;

#include <common>
#include <gbuffer_packing>
#include <sampleBlueNoise>

#define luminance(a) dot(vec3(0.2125, 0.7154, 0.0721), a)

vec3 getWorldPos(float depth, vec2 coord) {
    float z = depth * 2.0 - 1.0;
    vec4 clipSpacePosition = vec4(coord * 2.0 - 1.0, z, 1.0);
    vec4 viewSpacePosition = projectionMatrixInverse * clipSpacePosition;

    // Perspective division
    vec4 worldSpacePosition = cameraMatrixWorld * viewSpacePosition;
    worldSpacePosition.xyz /= worldSpacePosition.w;
    return worldSpacePosition.xyz;
}

float distToPlane(const vec3 worldPos, const vec3 neighborWorldPos, const vec3 worldNormal) {
    vec3 toCurrent = worldPos - neighborWorldPos;
    float distToPlane = abs(dot(toCurrent, worldNormal));

    return distToPlane;
}

float getDisocclusionWeight(float x) {
    // x = 0.;
    return sqrt(1. / (x + 1.));
}

// ! TODO: fix log space issue with certain models (NaN pixels) for example: see seiko-watch 3D model
void toLogSpace(inout vec3 color) {
    // color = dot(color, color) > 0.000000001 ? log(color) : vec3(0.000000001);
    // color = pow(color, vec3(1. / 8.));
}

void toLinearSpace(inout vec3 color) {
    // color = exp(color);
    // color = pow(color, vec3(8.));
}

void evaluateNeighbor(const vec4 neighborTexel, inout vec3 denoised, const float disocclusionWeight,
                      inout float totalWeight, const float basicWeight) {
    float w = pow(basicWeight, 1. / (1. + pow(disocclusionWeight, 4.) * 100.0));
    w *= luminance(neighborTexel.rgb);
    w = min(w, 1.);

    denoised += w * neighborTexel.rgb;
    totalWeight += w;
}

const float samplesFloat = float(samples);
const vec2 poissonDisk[samples] = POISSON_DISK_SAMPLES;

void main() {
    vec4 depthTexel = textureLod(depthTexture, vUv, 0.);

    if (depthTexel.r == 1.0) {
        discard;
        return;
    }

    vec4 texel = textureLod(inputTexture, vUv, 0.0);
    vec4 texel2 = textureLod(inputTexture2, vUv, 0.0);

    float min1 = min(texel.r, min(texel.g, texel.b));
    float min2 = min(texel2.r, min(texel2.g, texel2.b));

    bool useLogSpace = min1 > 0.000000001;
    bool useLogSpace2 = min2 > 0.000000001;

    if (useLogSpace) toLogSpace(texel.rgb);
    if (useLogSpace2) toLogSpace(texel2.rgb);

    vec3 diffuse, normal, emissive;
    float roughness, metalness;

    getGData(gBuffersTexture, vUv, diffuse, normal, roughness, metalness, emissive);

#ifdef NORMAL_IN_RGB
    float denoised = texel.a;
    float center = texel.a;
#else
    vec3 denoised = texel.rgb;
    vec3 center = texel.rgb;

    vec3 denoised2 = texel2.rgb;
    vec3 center2 = texel2.rgb;
#endif

    float depth = depthTexel.x;
    vec3 worldPos = getWorldPos(depth, vUv);

    float totalWeight = 1.0;
    float totalWeight2 = 1.0;

    // float angle = sampleBlueNoise(blueNoiseTexture, index, blueNoiseRepeat, resolution).r;
    // float s = sin(angle), c = cos(angle);
    // mat2 rotationMatrix = mat2(c, -s, s, c);

    float disocclusionWeight = getDisocclusionWeight(texel.a);
    float disocclusionWeight2 = getDisocclusionWeight(texel2.a);

    float specularWeight = roughness * roughness > 0.15 ? 1. : roughness * roughness / 0.15;
    specularWeight = pow(specularWeight * specularWeight, 8.0);
    // specularWeight = 1.;

    float a = min(texel.a, texel2.a);
    a = sqrt(a);
    float r = 32. / (a + 1.);
    r = 16.;

    for (int i = 0; i < samples; i++) {
        vec2 offset = r * poissonDisk[i] * smoothstep(0., 1., float(i) / samplesFloat);
        vec2 neighborUv = vUv + offset;

        vec4 neighborTexel = textureLod(inputTexture, neighborUv, 0.0);
        vec4 neighborTexel2 = textureLod(inputTexture2, neighborUv, 0.0);

        if (useLogSpace) toLogSpace(neighborTexel.rgb);
        if (useLogSpace2) toLogSpace(neighborTexel2.rgb);

        vec3 neighborNormal, neighborDiffuse;
        float neighborRoughness, neighborMetalness;

        getGData(gBuffersTexture, neighborUv, neighborDiffuse, neighborNormal, neighborRoughness, neighborMetalness);

        float neighborDepth = textureLod(depthTexture, neighborUv, 0.0).x;
        vec3 neighborWorldPos = getWorldPos(neighborDepth, neighborUv);

        float normalDiff = 1. - max(dot(normal, neighborNormal), 0.);
        float depthDiff = 1. + distToPlane(worldPos, neighborWorldPos, normal);
        depthDiff = depthDiff * depthDiff - 1.;

        float roughnessDiff = abs(roughness - neighborRoughness);
        float diffuseDiff = length(neighborDiffuse - diffuse);

        float lumaDiff = abs(luminance(neighborTexel.rgb) - luminance(neighborTexel2.rgb));

        float similarity = float(neighborDepth != 1.0) *
                           exp(-normalDiff * normalPhi - depthDiff * depthPhi - roughnessDiff * roughnessPhi - diffuseDiff * diffusePhi - lumaDiff * 0.);

        if (similarity > 1.) similarity = 1.;
        float s = 60.;
        float w = sqrt(1. / (texel2.a - s + 1.));
        if (texel2.a < 60.) w = 1.;

        similarity *= pow(w, 0.1);

        similarity = pow(similarity, lumaPhi + 1.);
        // similarity = 1.;

        evaluateNeighbor(neighborTexel, denoised, disocclusionWeight, totalWeight, similarity);
        evaluateNeighbor(neighborTexel2, denoised2, disocclusionWeight2, totalWeight2, similarity * specularWeight);
    }

    denoised /= totalWeight;
    denoised2 /= totalWeight2;

    if (useLogSpace) toLinearSpace(denoised);
    if (useLogSpace2) toLinearSpace(denoised2);

#define FINAL_OUTPUT

    gOutput0 = vec4(denoised, texel.a);
    gOutput1 = vec4(denoised2, texel2.a);
}