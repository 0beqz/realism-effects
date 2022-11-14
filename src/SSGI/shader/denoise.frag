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
uniform float denoiseKernel;
uniform float stepSize;
uniform mat4 _viewMatrix;
uniform mat4 _projectionMatrixInverse;
uniform mat4 projectionMatrix;
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

void main() {
    vec4 depthTexel = textureLod(depthTexture, vUv, 0.);
    vec4 inputTexel = textureLod(inputTexture, vUv, 0.);

    // skip background
    if (dot(depthTexel.rgb, depthTexel.rgb) == 0.) {
        gl_FragColor = inputTexel;
        gl_FragColor.a = 0.;
        return;
    }

    vec4 normalTexel = textureLod(normalTexture, vUv, 0.);
    vec3 viewNormal = unpackRGBToNormal(normalTexel.rgb);
    vec3 normal = normalize((vec4(viewNormal, 1.0) * _viewMatrix).xyz);

    float totalWeight = 1.;
    vec3 color = inputTexel.rgb;

    float depth = unpackRGBAToDepth(depthTexel);
    float luma = czm_luminance(inputTexel.rgb);
    vec2 pixelStepOffset = invTexSize * stepSize;

    float roughness = normalTexel.a;

    float kernel = denoiseKernel;
    float sumVariance;

#ifdef USE_MOMENT
    if (horizontal && stepSize == 1.) {
        vec2 moment = textureLod(momentsTexture, vUv, 0.).rg;

        sumVariance = max(0.0, moment.g - moment.r * moment.r);
    } else {
        sumVariance = inputTexel.a;
    }

    float colorPhi = lumaPhi * sqrt(FLOAT_EPSILON + sumVariance);
#else
    float colorPhi = lumaPhi;
#endif

    for (float i = -kernel; i <= kernel; i++) {
        if (i != 0.) {
            vec2 neighborVec = horizontal ? vec2(i, 0.) : vec2(0., i);
            vec2 neighborUv = vUv + neighborVec * pixelStepOffset;

            vec4 neighborDepthTexel = textureLod(depthTexture, neighborUv, 0.);

            float neighborDepth = unpackRGBAToDepth(neighborDepthTexel);

            float depthDiff = abs(depth - neighborDepth) * 50000.;
            float depthSimilarity = 1.0 - min(1.0, depthDiff * depthPhi);

            if (depthSimilarity > 0.) {
                vec4 neighborNormalTexel = textureLod(normalTexture, neighborUv, 0.);
                vec3 neighborNormal = unpackRGBToNormal(neighborNormalTexel.rgb);
                neighborNormal = normalize((vec4(neighborNormal, 1.0) * _viewMatrix).xyz);
                float neighborRoughness = neighborNormalTexel.a;

                float normalSimilarity = pow(max(0., dot(neighborNormal, normal)), normalPhi);

                if (normalSimilarity > 0.) {
                    vec4 neighborInputTexel = textureLod(inputTexture, neighborUv, 0.);
                    vec3 neighborColor = neighborInputTexel.rgb;
                    float neighborLuma = czm_luminance(neighborColor);

                    float lumaDiff = abs(luma - neighborLuma);
                    float lumaSimilarity = max(1.0 - lumaDiff / colorPhi, 0.0);
                    float roughnessDiff = abs(roughness - neighborRoughness);
                    float roughnessSimilarity = exp(-roughnessDiff * roughnessPhi);

                    float weight = normalSimilarity * lumaSimilarity * depthSimilarity * roughnessSimilarity;

                    if (weight > 0.) {
                        color += neighborColor * weight;

                        totalWeight += weight;

#ifdef USE_MOMENT
                        float neighborVariance;
                        if (stepSize > 1.) {
                            neighborVariance = neighborInputTexel.a;
                        } else {
                            vec2 neighborMoment = textureLod(momentsTexture, neighborUv, 0.).rg;

                            neighborVariance = max(0.0, neighborMoment.g - neighborMoment.r * neighborMoment.r);
                        }

                        sumVariance += weight * weight * neighborVariance;
#endif
                    }
                }
            }
        }
    }

    sumVariance /= totalWeight * totalWeight;
    color /= totalWeight;

    gl_FragColor = vec4(color, sumVariance);
}