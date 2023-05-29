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
uniform bool isFirstIteration;
uniform bool isLastIteration;

layout(location = 0) out vec4 gDiffuse;
layout(location = 1) out vec4 gSpecular;

#include <common>
#include <gbuffer_packing>
#include <sampleBlueNoise>

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
#endif

    return vec3(0.);
}

float distToPlane(const vec3 worldPos, const vec3 neighborWorldPos, const vec3 worldNormal) {
    vec3 toCurrent = worldPos - neighborWorldPos;
    float distToPlane = abs(dot(toCurrent, worldNormal));

    return distToPlane;
}

// source: https://github.com/mrdoob/three.js/blob/dev/examples/js/shaders/SSAOShader.js
vec3 getViewPosition(const float depth) {
    float clipW = projectionMatrix[2][3] * depth + projectionMatrix[3][3];
    vec4 clipPosition = vec4((vec3(vUv, depth) - 0.5) * 2.0, 1.0);
    clipPosition *= clipW;
    return (projectionMatrixInverse * clipPosition).xyz;
}

vec3 F_Schlick(const vec3 f0, const float theta) {
    return f0 + (1. - f0) * pow(1.0 - theta, 5.);
}

vec3 SampleGGXVNDF(const vec3 V, const float ax, const float ay, const float r1, const float r2) {
    vec3 Vh = normalize(vec3(ax * V.x, ay * V.y, V.z));

    float lensq = Vh.x * Vh.x + Vh.y * Vh.y;
    vec3 T1 = lensq > 0. ? vec3(-Vh.y, Vh.x, 0.) * inversesqrt(lensq) : vec3(1., 0., 0.);
    vec3 T2 = cross(Vh, T1);

    float r = sqrt(r1);
    float phi = 2.0 * PI * r2;
    float t1 = r * cos(phi);
    float t2 = r * sin(phi);
    float s = 0.5 * (1.0 + Vh.z);
    t2 = (1.0 - s) * sqrt(1.0 - t1 * t1) + s * t2;

    vec3 Nh = t1 * T1 + t2 * T2 + sqrt(max(0.0, 1.0 - t1 * t1 - t2 * t2)) * Vh;

    return normalize(vec3(ax * Nh.x, ay * Nh.y, max(0.0, Nh.z)));
}

void Onb(const vec3 N, inout vec3 T, inout vec3 B) {
    vec3 up = abs(N.z) < 0.9999999 ? vec3(0, 0, 1) : vec3(1, 0, 0);
    T = normalize(cross(up, N));
    B = cross(N, T);
}

vec3 ToLocal(const vec3 X, const vec3 Y, const vec3 Z, const vec3 V) {
    return vec3(dot(V, X), dot(V, Y), dot(V, Z));
}

vec3 ToWorld(const vec3 X, const vec3 Y, const vec3 Z, const vec3 V) {
    return V.x * X + V.y * Y + V.z * Z;
}

float getDisocclusionWeight(float x) {
    return 1. / (x + 1.);
}

void toLogSpace(inout vec3 color) {
    color = dot(color, color) > 0.000001 ? log(color) : vec3(0.000001);
}

void toLinearSpace(inout vec3 color) {
    color = exp(color);
}

void evaluateNeighbor(
    const vec3 center, const float centerLum, const vec4 neighborTexel, inout vec3 denoised, const float disocclusionWeight,
    inout float totalWeight, const float basicWeight) {
    float w = min(1., basicWeight * (0.5 + disocclusionWeight * 500.));

    w = mix(w, 1., disocclusionWeight);

    denoised += w * neighborTexel.rgb;
    totalWeight += w;
}

void main() {
    vec4 depthTexel = textureLod(depthTexture, vUv, 0.);

    if (depthTexel.r == 1.0 || dot(depthTexel.rgb, depthTexel.rgb) == 0.) {
        discard;
        return;
    }

    vec4 texel = textureLod(inputTexture, vUv, 0.0);
    vec4 texel2 = textureLod(inputTexture2, vUv, 0.0);

    float min1 = min(texel.r, min(texel.g, texel.b));
    float min2 = min(texel2.r, min(texel2.g, texel2.b));

    bool useLogSpace = min1 > 0.001;
    bool useLogSpace2 = min2 > 0.001;

    if (useLogSpace) toLogSpace(texel.rgb);
    if (useLogSpace2) toLogSpace(texel2.rgb);

    vec3 normal = getNormal(vUv, texel);

    vec3 diffuse, emissive;
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

    float centerLum = luminance(center);
    float centerLum2 = luminance(center2);

    float depth = depthTexel.x;
    vec3 worldPos = getWorldPos(depth, vUv);

    float totalWeight = 1.0;
    float totalWeight2 = 1.0;

    vec4 blueNoise = sampleBlueNoise(blueNoiseTexture, 0, blueNoiseRepeat, resolution);
    float angle = blueNoise[index];

    float s = sin(angle), c = cos(angle);

    mat2 rotationMatrix = mat2(c, -s, s, c);

    float disocclusionWeight = getDisocclusionWeight(texel.a);
    float disocclusionWeight2 = getDisocclusionWeight(texel2.a);

    float dw = max(disocclusionWeight, disocclusionWeight2);

    float denoiseOffset = mix(1., roughness, metalness) * (0.5 + dw * 2.);
    float mirror = roughness * roughness > 0.1 ? 1. : roughness * roughness / 0.1;

    for (int i = 0; i < samples; i++) {
        vec2 offset = rotationMatrix * poissonDisk[i] * denoiseOffset * smoothstep(0., 1., float(i) / float(samples));
        vec2 neighborUv = vUv + offset;

        vec4 neighborTexel = textureLod(inputTexture, neighborUv, 0.0);
        vec4 neighborTexel2 = textureLod(inputTexture2, neighborUv, 0.0);

        if (useLogSpace) toLogSpace(neighborTexel.rgb);
        if (useLogSpace2) toLogSpace(neighborTexel2.rgb);

        vec3 neighborNormal, neighborDiffuse, neighborEmissive;
        float neighborRoughness, neighborMetalness;

        getGData(gBuffersTexture, neighborUv, neighborDiffuse, neighborNormal, neighborRoughness, neighborMetalness, neighborEmissive);

        float neighborDepth = textureLod(depthTexture, neighborUv, 0.0).x;
        vec3 neighborWorldPos = getWorldPos(neighborDepth, neighborUv);

        float normalDiff = 1. - max(dot(normal, neighborNormal), 0.);
        float normalSimilarity = exp(-normalDiff * normalPhi);

        float depthDiff = 1. + distToPlane(worldPos, neighborWorldPos, normalize(normal + neighborNormal));
        depthDiff = depthDiff * depthDiff - 1.;
        float depthSimilarity = exp(-depthDiff * depthPhi);

        float roughnessDiff = abs(roughness - neighborRoughness);
        float roughnessSimilarity = exp(-roughnessDiff * roughnessPhi);

        float metalnessDiff = abs(metalness - neighborMetalness);
        float metalnessSimilarity = exp(-metalnessDiff * roughnessPhi);

        float diffuseDiff = length(neighborDiffuse - diffuse);
        float diffuseSimilarity = exp(-diffuseDiff * diffusePhi);

        float bw = max(0.001, depthSimilarity * roughnessSimilarity * metalnessSimilarity * diffuseSimilarity);
        float basicWeight = normalSimilarity * bw;

        basicWeight = pow(basicWeight, lumaPhi);

        evaluateNeighbor(center, centerLum, neighborTexel, denoised, disocclusionWeight, totalWeight, basicWeight);

        // ! todo: account for roughness
        basicWeight = pow(basicWeight, 1. + (1. - mirror) * 100.);
        evaluateNeighbor(center2, centerLum2, neighborTexel2, denoised2, disocclusionWeight2, totalWeight2, basicWeight);
    }

    if (totalWeight > 0.) denoised /= totalWeight;
    if (totalWeight2 > 0.) denoised2 /= totalWeight2;

    if (useLogSpace) toLinearSpace(denoised);
    if (useLogSpace2) toLinearSpace(denoised2);

#ifdef NORMAL_IN_RGB
    gDiffuse = vec4(normal, denoised);
    gSpecular = vec4(0.);
#else
    if (isLastIteration) {
        roughness *= roughness;

        vec3 viewNormal = (vec4(normal, 0.) * cameraMatrixWorld).xyz;

        // view-space position of the current texel
        vec3 viewPos = getViewPosition(depth);
        vec3 viewDir = normalize(viewPos);

        vec3 T, B;

        vec3 v = viewDir;  // incoming vector

        // convert view dir and view normal to world-space
        vec3 V = (vec4(v, 0.) * viewMatrix).xyz;  // invert view dir
        vec3 N = normal;

        Onb(N, T, B);

        V = ToLocal(T, B, N, V);

        // seems to approximate Fresnel very well
        vec3 H = SampleGGXVNDF(V, roughness, roughness, 0.25, 0.25);
        if (H.z < 0.0) H = -H;

        vec3 l = normalize(reflect(-V, H));
        l = ToWorld(T, B, N, l);

        // convert reflected vector back to view-space
        l = (vec4(l, 1.) * cameraMatrixWorld).xyz;
        l = normalize(l);

        if (dot(viewNormal, l) < 0.) l = -l;

        vec3 h = normalize(v + l);  // half vector

        // try to approximate the fresnel term we get when accumulating over multiple frames
        float VoH = max(EPSILON, dot(v, h));

        // fresnel
        vec3 f0 = mix(vec3(0.04), diffuse, metalness);
        vec3 F = F_Schlick(f0, VoH);

        vec3 diffuseLightingColor = denoised;
        vec3 diffuseComponent = diffuse * (1. - metalness) * (1. - F) * diffuseLightingColor;

        vec3 specularLightingColor = denoised2;
        vec3 specularComponent = specularLightingColor * F;

        // vec3 directLight = textureLod(directLightTexture, vUv, 0.).rgb;

        denoised = diffuseComponent + specularComponent;
        // denoised = denoised2;
        // denoised = vec3(totalWeight / float(samples));
        // denoised = vec3(roughness < 0.025 ? 1. : 0.);
    }

    gDiffuse = vec4(denoised, texel.a);
    gSpecular = vec4(denoised2, texel2.a);
#endif
}