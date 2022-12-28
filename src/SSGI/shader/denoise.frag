varying vec2 vUv;

uniform sampler2D inputTexture;
uniform sampler2D depthTexture;
uniform sampler2D normalTexture;
uniform sampler2D momentsTexture;
uniform vec2 invTexSize;
uniform bool horizontal;
uniform float lumaPhi;
uniform float depthPhi;
uniform float normalPhi;
uniform float roughnessPhi;
uniform float curvaturePhi;
uniform float denoiseKernel;
uniform float stepSize;
uniform mat4 _viewMatrix;
uniform mat4 _projectionMatrixInverse;
uniform mat4 projectionMatrix;
uniform mat4 cameraMatrixWorld;
uniform bool isLastIteration;

#include <packing>

#define ALPHA_STEP    0.001
#define FLOAT_EPSILON 0.00001

// source: https://github.com/CesiumGS/cesium/blob/main/Source/Shaders/Builtin/Functions/luminance.glsl
float czm_luminance(vec3 rgb) {
    // Algorithm from Chapter 10 of Graphics Shaders.
    const vec3 W = vec3(0.2125, 0.7154, 0.0721);
    return dot(rgb, W);
}

float getCurvature(vec3 normal) {
    vec3 dx = dFdx(normal);
    vec3 dy = dFdy(normal);

    float x = dot(dx, dx);
    float y = dot(dy, dy);

    float curvature = sqrt(x * x + y * y);

    return curvature;
}

vec3 screenSpaceToWorldSpace(const vec2 uv, const float depth, mat4 curMatrixWorld) {
    vec4 ndc = vec4(
        (uv.x - 0.5) * 2.0,
        (uv.y - 0.5) * 2.0,
        (depth - 0.5) * 2.0,
        1.0);

    vec4 clip = _projectionMatrixInverse * ndc;
    vec4 view = curMatrixWorld * (clip / clip.w);

    return view.xyz;
}

float distToPlane(vec3 worldPos, vec3 neighborWorldPos, vec3 worldNormal) {
    vec3 toCurrent = worldPos - neighborWorldPos;
    float distToPlane = abs(dot(toCurrent, worldNormal));

    return distToPlane;
}

void tap(vec2 neighborVec, vec2 pixelStepOffset, float depth, vec3 normal, float curvature, float roughness, vec3 worldPos, float luma, float colorPhi,
         inout vec3 color, inout float totalWeight, inout float sumVariance) {
    vec2 neighborUv = vUv + neighborVec * pixelStepOffset;

    vec4 neighborDepthTexel = textureLod(depthTexture, neighborUv, 0.);
    float neighborDepth = unpackRGBAToDepth(neighborDepthTexel);
    vec3 neighborWorldPos = screenSpaceToWorldSpace(neighborUv, neighborDepth, cameraMatrixWorld);

    float depthSimilarity = max((1. - distToPlane(worldPos, neighborWorldPos, normal)) / depthPhi, 0.);

    vec4 neighborNormalTexel = textureLod(normalTexture, neighborUv, 0.);
    vec3 neighborNormal = unpackRGBToNormal(neighborNormalTexel.rgb);
    neighborNormal = normalize((vec4(neighborNormal, 1.0) * _viewMatrix).xyz);
    float neighborRoughness = neighborNormalTexel.a;

    float normalSimilarity = pow(max(0., dot(neighborNormal, normal)), normalPhi);

    vec4 neighborInputTexel = textureLod(inputTexture, neighborUv, 0.);
    vec3 neighborColor = neighborInputTexel.rgb;
    float neighborLuma = czm_luminance(neighborColor);
    float neighborCurvature = getCurvature(neighborNormal);

    float lumaSimilarity = max(1.0 - abs(luma - neighborLuma) / colorPhi, 0.0);
    float roughnessSimilarity = exp(-abs(roughness - neighborRoughness) * roughnessPhi);
    float curvatureSimilarity = exp(-abs(curvature - neighborCurvature) * curvaturePhi);

    float weight = normalSimilarity * lumaSimilarity * depthSimilarity * roughnessSimilarity * curvatureSimilarity;
    if (weight > 1.0) weight = 1.0;

    color += neighborColor * weight;

    totalWeight += weight;

#ifdef USE_MOMENT
    float neighborVariance;
    if (horizontal && stepSize == 1.) {
        neighborVariance = neighborInputTexel.a;
    } else {
        vec2 neighborMoment = textureLod(momentsTexture, neighborUv, 0.).rg;

        neighborVariance = max(0.0, neighborMoment.g - neighborMoment.r * neighborMoment.r);
    }

    sumVariance += weight * weight * neighborVariance;
#endif
}

void main() {
    vec4 depthTexel = textureLod(depthTexture, vUv, 0.);
    vec4 inputTexel = textureLod(inputTexture, vUv, 0.);

    // skip background
    if (dot(depthTexel.rgb, depthTexel.rgb) == 0.) {
        gl_FragColor = vec4(inputTexel.rgb, 0.);
        return;
    }

    vec4 normalTexel = textureLod(normalTexture, vUv, 0.);
    vec3 viewNormal = unpackRGBToNormal(normalTexel.rgb);
    vec3 normal = normalize((vec4(viewNormal, 1.0) * _viewMatrix).xyz);
    float curvature = getCurvature(normal);

    float totalWeight = 1.;
    vec3 color = inputTexel.rgb;

    float depth = unpackRGBAToDepth(depthTexel);
    float luma = czm_luminance(inputTexel.rgb);
    vec2 pixelStepOffset = invTexSize * stepSize;

    vec3 worldPos = screenSpaceToWorldSpace(vUv, depth, cameraMatrixWorld);

    float roughness = normalTexel.a;

    float kernel = denoiseKernel;
    float sumVariance;

    float colorPhi = lumaPhi;

#ifdef USE_MOMENT
    if (horizontal && stepSize == 1.) {
        vec2 moment = textureLod(momentsTexture, vUv, 0.).rg;

        sumVariance = max(0.0, moment.g - moment.r * moment.r);
    } else {
        sumVariance = inputTexel.a;
    }

    colorPhi = lumaPhi * sqrt(FLOAT_EPSILON + sumVariance);
#endif

    // horizontal / vertical
    for (float i = -kernel; i <= kernel; i++) {
        if (i != 0.) {
            vec2 neighborVec = horizontal ? vec2(i, 0.) : vec2(0., i);
            tap(neighborVec, pixelStepOffset, depth, normal, curvature, roughness, worldPos, luma, colorPhi, color, totalWeight, sumVariance);
        }
    }

    // diagonal (top left to bottom right) / diagonal (top right to bottom left)
    for (float i = -kernel; i <= kernel; i++) {
        if (i != 0.) {
            vec2 neighborVec = horizontal ? vec2(-i, -i) : vec2(-i, i);
            tap(neighborVec, pixelStepOffset, depth, normal, curvature, roughness, worldPos, luma, colorPhi, color, totalWeight, sumVariance);
        }
    }

    sumVariance /= totalWeight * totalWeight;
    color /= totalWeight;

    if (isLastIteration) sumVariance = 1.;

    gl_FragColor = vec4(color, sumVariance);
}