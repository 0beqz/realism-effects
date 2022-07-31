// a basic shader to implement temporal resolving

uniform sampler2D inputTexture;
uniform sampler2D accumulatedTexture;
uniform sampler2D velocityTexture;
uniform sampler2D lastVelocityTexture;
uniform sampler2D depthTexture;

uniform float temporalResolveCorrectionMix;

varying vec2 vUv;

#include <packing>

// source: https://github.com/blender/blender/blob/594f47ecd2d5367ca936cf6fc6ec8168c2b360d0/source/blender/draw/intern/shaders/common_math_lib.glsl#L42
#define min3(a, b, c) min(a, min(b, c))
#define min4(a, b, c, d) min(a, min3(b, c, d))
#define min5(a, b, c, d, e) min(a, min4(b, c, d, e))
#define min6(a, b, c, d, e, f) min(a, min5(b, c, d, e, f))
#define min7(a, b, c, d, e, f, g) min(a, min6(b, c, d, e, f, g))
#define min8(a, b, c, d, e, f, g, h) min(a, min7(b, c, d, e, f, g, h))
#define min9(a, b, c, d, e, f, g, h, i) min(a, min8(b, c, d, e, f, g, h, i))

#define max3(a, b, c) max(a, max(b, c))
#define max4(a, b, c, d) max(a, max3(b, c, d))
#define max5(a, b, c, d, e) max(a, max4(b, c, d, e))
#define max6(a, b, c, d, e, f) max(a, max5(b, c, d, e, f))
#define max7(a, b, c, d, e, f, g) max(a, max6(b, c, d, e, f, g))
#define max8(a, b, c, d, e, f, g, h) max(a, max7(b, c, d, e, f, g, h))
#define max9(a, b, c, d, e, f, g, h, i) max(a, max8(b, c, d, e, f, g, h, i))

// note: see also http://www.decarpentier.nl/2d-catmull-rom-in-4-samples.

vec4 sampleLevel0(sampler2D tex, vec2 uv) {
    return texture(tex, uv, -10.0);
}

// source: https://www.shadertoy.com/view/MtVGWz
// note: entirely stolen from https://gist.github.com/TheRealMJP/c83b8c0f46b63f3a88a5986f4fa982b1
//
// Samples a texture with Catmull-Rom filtering, using 9 texture fetches instead of 16.
// See http://vec3.ca/bicubic-filtering-in-fewer-taps/ for more details
vec4 SampleTextureCatmullRom(sampler2D tex, vec2 uv, vec2 texSize) {
    // We're going to sample a a 4x4 grid of texels surrounding the target UV coordinate. We'll do this by rounding
    // down the sample location to get the exact center of our "starting" texel. The starting texel will be at
    // location [1, 1] in the grid, where [0, 0] is the top left corner.
    vec2 samplePos = uv * texSize;
    vec2 texPos1 = floor(samplePos - 0.5) + 0.5;

    // Compute the fractional offset from our starting texel to our original sample location, which we'll
    // feed into the Catmull-Rom spline function to get our filter weights.
    vec2 f = samplePos - texPos1;

    // Compute the Catmull-Rom weights using the fractional offset that we calculated earlier.
    // These equations are pre-expanded based on our knowledge of where the texels will be located,
    // which lets us avoid having to evaluate a piece-wise function.
    vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
    vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
    vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
    vec2 w3 = f * f * (-0.5 + 0.5 * f);

    // Work out weighting factors and sampling offsets that will let us use bilinear filtering to
    // simultaneously evaluate the middle 2 samples from the 4x4 grid.
    vec2 w12 = w1 + w2;
    vec2 offset12 = w2 / w12;

    // Compute the final UV coordinates we'll use for sampling the texture
    vec2 texPos0 = texPos1 - vec2(1.0);
    vec2 texPos3 = texPos1 + vec2(2.0);
    vec2 texPos12 = texPos1 + offset12;

    texPos0 /= texSize;
    texPos3 /= texSize;
    texPos12 /= texSize;

    vec4 result = vec4(0.0);
    result += sampleLevel0(tex, vec2(texPos0.x, texPos0.y)) * w0.x * w0.y;
    result += sampleLevel0(tex, vec2(texPos12.x, texPos0.y)) * w12.x * w0.y;
    result += sampleLevel0(tex, vec2(texPos3.x, texPos0.y)) * w3.x * w0.y;
    result += sampleLevel0(tex, vec2(texPos0.x, texPos12.y)) * w0.x * w12.y;
    result += sampleLevel0(tex, vec2(texPos12.x, texPos12.y)) * w12.x * w12.y;
    result += sampleLevel0(tex, vec2(texPos3.x, texPos12.y)) * w3.x * w12.y;
    result += sampleLevel0(tex, vec2(texPos0.x, texPos3.y)) * w0.x * w3.y;
    result += sampleLevel0(tex, vec2(texPos12.x, texPos3.y)) * w12.x * w3.y;
    result += sampleLevel0(tex, vec2(texPos3.x, texPos3.y)) * w3.x * w3.y;

    return result;
}

// source: https://www.elopezr.com/temporal-aa-and-the-quest-for-the-holy-trail/ (modified to GLSL)
vec2 getVelocity(sampler2D tex, vec2 uv, vec2 texSize) {
    float closestDepth = 100.0;
    vec2 closestUVOffset;

    for (int j = -1; j <= 1; ++j) {
        for (int i = -1; i <= 1; ++i) {
            vec2 uvOffset = vec2(i, j) / texSize;

            float neighborDepth = unpackRGBAToDepth(textureLod(depthTexture, vUv + uvOffset, 0.));

            if (neighborDepth < closestDepth) {
                closestUVOffset = uvOffset;
                closestDepth = neighborDepth;
            }
        }
    }

    return textureLod(velocityTexture, vUv + closestUVOffset, 0.).xy;
}

void main() {
    vec4 inputTexel = texture2D(inputTexture, vUv);

    vec4 accumulatedTexel;
    vec3 outputColor;

    // REPROJECT_START

    ivec2 size = textureSize(inputTexture, 0);
    vec2 pxSize = vec2(float(size.x), float(size.y));

    vec4 velocityTexel = texture2D(velocityTexture, vUv);

    vec2 velUv = velocityTexel.xy;
    vec2 reprojectedUv = vUv - velUv;

    vec2 lastVelUv = texture2D(lastVelocityTexture, reprojectedUv).xy;

    float velocityLength = length(lastVelUv - velUv);

    // idea from: https://www.elopezr.com/temporal-aa-and-the-quest-for-the-holy-trail/
    float velocityDisocclusion = (velocityLength - 0.000005) * 10.;
    velocityDisocclusion *= velocityDisocclusion;

#ifdef DILATION
    velUv = getVelocity(velocityTexture, vUv, pxSize);
    reprojectedUv = vUv - velUv;
#endif

    vec3 averageNeighborColor;

    bool didReproject = true;

    float movement = length(velUv) * 100.;
    vec2 px = 1. / pxSize;

    // get neighbor pixels
    vec3 c02 = texture2D(inputTexture, vUv + vec2(-px.x, px.y)).rgb;
    vec3 c12 = texture2D(inputTexture, vUv + vec2(0., px.y)).rgb;
    vec3 c22 = texture2D(inputTexture, vUv + vec2(px.x, px.y)).rgb;
    vec3 c01 = texture2D(inputTexture, vUv + vec2(-px.x, 0.)).rgb;
    vec3 c11 = inputTexel.rgb;
    vec3 c21 = texture2D(inputTexture, vUv + vec2(px.x, 0.)).rgb;
    vec3 c00 = texture2D(inputTexture, vUv + vec2(-px.x, -px.y)).rgb;
    vec3 c10 = texture2D(inputTexture, vUv + vec2(0., -px.y)).rgb;
    vec3 c20 = texture2D(inputTexture, vUv + vec2(px.x, -px.y)).rgb;

    // check if reprojecting is necessary (due to movement) and that the reprojected UV is valid
    if (reprojectedUv.x >= 0. && reprojectedUv.x <= 1. && reprojectedUv.y >= 0. && reprojectedUv.y <= 1.) {
        accumulatedTexel = texture2D(accumulatedTexture, vUv);

        // neighborhood clamping (only for the first sample where the camera just moved)

        vec3 minNeighborColor = min9(c02, c12, c22, c01, c11, c21, c00, c10, c20);
        vec3 maxNeighborColor = max9(c02, c12, c22, c01, c11, c21, c00, c10, c20);

        vec3 clampedColor = clamp(accumulatedTexel.rgb, minNeighborColor, maxNeighborColor);

        // float clampMix = movement >= 0.25 || velocityDisocclusion > 0.001 ? temporalResolveCorrectionMix : temporalResolveCorrectionMix * 0.5;
        float clampMix = temporalResolveCorrectionMix;

        accumulatedTexel.rgb = mix(accumulatedTexel.rgb, clampedColor, clampMix);
    } else {
        // reprojected UV coordinates are outside of screen, so just use the current frame for it
        accumulatedTexel.rgb = inputTexel.rgb;
        didReproject = false;
    }

    // REPROJECT_END

// the user's shader to compose a final outputColor from the inputTexel and accumulatedTexel
#include <custom_compose_shader>

    gl_FragColor = vec4(outputColor, alpha);
}