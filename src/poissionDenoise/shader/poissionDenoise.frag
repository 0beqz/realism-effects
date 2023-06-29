varying vec2 vUv;

uniform sampler2D inputTexture;
uniform sampler2D inputTexture2;
uniform sampler2D depthTexture;
uniform sampler2D directLightTexture;
uniform mat4 projectionMatrixInverse;
uniform mat4 projectionMatrix;
uniform mat4 cameraMatrixWorld;
uniform float radius;
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

float getCurvature(vec3 n, float depth) {
    vec3 dx = dFdx(n);
    vec3 dy = dFdy(n);
    vec3 xneg = n - dx;
    vec3 xpos = n + dx;
    vec3 yneg = n - dy;
    vec3 ypos = n + dy;
    float curvature = (cross(xneg, xpos).y - cross(yneg, ypos).x) * 4.0 / depth;

    return curvature;
}

float distToPlane(const vec3 worldPos, const vec3 neighborWorldPos, const vec3 worldNormal) {
    vec3 toCurrent = worldPos - neighborWorldPos;
    float distToPlane = abs(dot(toCurrent, worldNormal));

    return distToPlane;
}

void toDenoiseSpace(inout vec3 color) {
    color = log(color + 1.);
}

void toLinearSpace(inout vec3 color) {
    color = exp(color) - 1.;
}

float getLuminanceWeight(float luminance, float a) {
    return mix(
        1. / (luminance + 0.01),
        1.,
        1. / pow(a + 1., 2.333));
}

void evaluateNeighbor(const vec4 neighborTexel, const float neighborLuminance, inout vec3 denoised,
                      inout float totalWeight, const float basicWeight) {
    float w = basicWeight;
    // w *= getLuminanceWeight(neighborLuminance, neighborTexel.a);

    denoised += w * neighborTexel.rgb;
    totalWeight += w;
}

const vec2 poissonDisk[samples] = POISSON_DISK_SAMPLES;

void main() {
    vec4 depthTexel = textureLod(depthTexture, vUv, 0.);

    if (depthTexel.r == 1.0) {
        discard;
        return;
    }

    vec4 texel = textureLod(inputTexture, vUv, 0.0);
    vec4 texel2 = textureLod(inputTexture2, vUv, 0.0);

    // if (vUv.x > 0.5) {
    //     gOutput0 = texel;
    //     gOutput1 = texel2;

    //     return;
    // }

    float totalWeight = getLuminanceWeight(luminance(texel.rgb), texel.a);
    float totalWeight2 = getLuminanceWeight(luminance(texel2.rgb), texel2.a);

    toDenoiseSpace(texel.rgb);
    toDenoiseSpace(texel2.rgb);

    vec3 denoised = texel.rgb * totalWeight;
    vec3 denoised2 = texel2.rgb * totalWeight2;

    vec3 diffuse, normal, emissive;
    float roughness, metalness;

    getGData(gBuffersTexture, vUv, diffuse, normal, roughness, metalness, emissive);

    float depth = depthTexel.x;
    vec3 worldPos = getWorldPos(depth, vUv);

    vec4 random = sampleBlueNoise(blueNoiseTexture, index, blueNoiseRepeat, resolution);
    float angle = random.r * 2. * PI;
    float s = sin(angle), c = cos(angle);
    mat2 rotationMatrix = mat2(c, -s, s, c);

    float specularWeight = roughness * roughness > 0.15 ? 1. : roughness * roughness / 0.15;
    specularWeight = pow(specularWeight * specularWeight, 4.);

    texel.a = min(texel.a, 60.0);
    texel2.a = min(texel2.a, 60.0);

    float w = 1. / pow(texel.a + 1., 1. / 2.333) + 0.01;
    float w2 = 1. / pow(texel2.a + 1., 1. / 2.333) + 0.01;

    float r = radius;
    float curvature = getCurvature(normal, depth);
    r = mix(r, 4., min(1., curvature * curvature));

    for (int i = 0; i < samples; i++) {
        vec2 offset = r * rotationMatrix * poissonDisk[i];
        vec2 neighborUv = vUv + offset;

        vec4 neighborTexel = textureLod(inputTexture, neighborUv, 0.);
        vec4 neighborTexel2 = textureLod(inputTexture2, neighborUv, 0.);

        float neighborLuminance = luminance(neighborTexel.rgb);
        float neighborLuminance2 = luminance(neighborTexel2.rgb);

        toDenoiseSpace(neighborTexel.rgb);
        toDenoiseSpace(neighborTexel2.rgb);

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

        float similarity = float(neighborDepth != 1.0) *
                           exp(-normalDiff * normalPhi - depthDiff * depthPhi - roughnessDiff * roughnessPhi - diffuseDiff * diffusePhi);

        float simW = lumaPhi;
        float similarity2 = w2 * pow(similarity, simW / w2) * specularWeight;

        similarity *= w;
        similarity = pow(similarity, simW / w);

        evaluateNeighbor(neighborTexel, neighborLuminance, denoised, totalWeight, similarity);
        evaluateNeighbor(neighborTexel2, neighborLuminance2, denoised2, totalWeight2, similarity2);
    }

    denoised = totalWeight > 0. ? denoised / totalWeight : texel.rgb;
    denoised2 = totalWeight2 > 0. ? denoised2 / totalWeight2 : texel2.rgb;

    toLinearSpace(denoised);
    toLinearSpace(denoised2);

#define FINAL_OUTPUT

    // denoised = vec3(r < 2. ? 1. : 0.);

    gOutput0 = vec4(denoised, texel.a);
    gOutput1 = vec4(denoised2, texel2.a);
}