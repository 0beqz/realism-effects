varying vec2 vUv;

uniform sampler2D inputTexture;
uniform sampler2D depthTexture;
uniform sampler2D normalTexture;
uniform vec2 invTexSize;
uniform bool horizontal;
uniform float denoisePower;
uniform float denoiseSharpness;
uniform float denoiseKernel;
uniform float jitter;
uniform float jitterRoughness;
uniform float stepSize;

// uniform float kernel1[] = float[](0.3311108596640263, 0.33777828067194743, 0.331110859664026);
// uniform float kernel2[] = float[](0.19207709898427072, 0.203913232931118, 0.20801933616922258, 0.203913232931118, 0.19207709898427072);
// uniform float kernel3[] = float[](0.12900108216683737, 0.1425207917273954, 0.1513031774986128, 0.1543498972143089, 0.1513031774986128, 0.1425207917273954, 0.12900108216683737);
// uniform float kernel4[] = float[](0.09163686898681825, 0.10535857163547686, 0.11640047348855351, 0.12357327859115343, 0.12606161459599594, 0.12357327859115343, 0.11640047348855351, 0.10535857163547686, 0.09163686898681825);

uniform float kernelCoefficients[7];

#include <packing>

#define ALPHA_STEP    0.001
#define FLOAT_EPSILON 0.00001

const float maxDepthDifference = 0.000025;

// source: https://github.com/CesiumGS/cesium/blob/main/Source/Shaders/Builtin/Functions/luminance.glsl
float czm_luminance(vec3 rgb) {
    // Algorithm from Chapter 10 of Graphics Shaders.
    const vec3 W = vec3(0.2125, 0.7154, 0.0721);
    return dot(rgb, W);
}

void main() {
    vec4 depthTexel = textureLod(depthTexture, vUv, 0.);

    // skip background
    if (dot(depthTexel.rgb, depthTexel.rgb) == 0.) return;

    vec4 inputTexel = textureLod(inputTexture, vUv, 0.);

    vec4 normalTexel = textureLod(normalTexture, vUv, 0.);
    vec3 normal = unpackRGBToNormal(normalTexel.rgb);

    float roughness = normalTexel.a;
    float roughnessFactor = min(1., jitterRoughness * roughness + jitter);

    float kernel = round(denoiseKernel * roughnessFactor);

    if (kernel == 0.) {
        gl_FragColor = inputTexel;
        return;
    }

    float totalWeight = kernelCoefficients[int(denoiseKernel) + 1];
    vec3 color = inputTexel.rgb * totalWeight;

    float similarityMix = 1.0 - denoiseSharpness;
    float depth = unpackRGBAToDepth(depthTexel);
    float luma = czm_luminance(inputTexel.rgb);
    float lumaPhi = denoiseSharpness * sqrt(FLOAT_EPSILON + luma);

    for (float i = -kernel; i <= kernel; i++) {
        if (i != 0.) {
            vec2 neighborVec = horizontal ? vec2(i, 0.) : vec2(0., i);
            vec2 neighborUv = vUv + neighborVec * invTexSize * stepSize;

            if (all(greaterThanEqual(neighborUv, vec2(0.))) && all(lessThanEqual(neighborUv, vec2(1.)))) {
                float neighborDepth = unpackRGBAToDepth(textureLod(depthTexture, neighborUv, 0.));
                vec3 neighborColor = textureLod(inputTexture, neighborUv, 0.).rgb;
                float neighborLuma = czm_luminance(neighborColor);

                float depthDiff = abs(depth - neighborDepth) * depth;

                if (depthDiff < maxDepthDifference) {
                    vec4 neighborNormalTexel = textureLod(normalTexture, neighborUv, 0.);
                    vec3 neighborNormal = unpackRGBToNormal(neighborNormalTexel.rgb);

                    float lumaDiff = abs(luma - neighborLuma);

                    float normalSimilarity = dot(neighborNormal, normal);
                    float lumaSimilarity = 1.0 - lumaDiff / lumaPhi;
                    float depthSimilarity = 1.0 - depthDiff;

                    // @todo: take account of depth again here
                    float weight = 1.;
                    weight *= normalSimilarity * lumaSimilarity * depthSimilarity;

                    if (weight > 0.) {
                        float kernelWeight = kernelCoefficients[int(i + kernel)];
                        weight = pow(weight, denoisePower);
                        weight *= kernelWeight;

                        totalWeight += weight;

                        color += neighborColor * weight;
                    }
                }
            }
        }
    }

    color /= totalWeight;

    if (min(color.r, min(color.g, color.b)) < 0.0) color = inputTexel.rgb;

    gl_FragColor = vec4(color, inputTexel.a);
}