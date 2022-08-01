// a basic shader to implement temporal resolving

uniform sampler2D inputTexture;
uniform sampler2D accumulatedTexture;
uniform sampler2D velocityTexture;
uniform sampler2D lastVelocityTexture;

uniform float correction;
uniform vec2 jitter;

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

#ifdef DILATION
uniform sampler2D depthTexture;

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

// credits for transforming screen position to world position: https://discourse.threejs.org/t/reconstruct-world-position-in-screen-space-from-depth-buffer/5532/2
vec3 screenSpaceToWorldSpace(const vec2 uv, const float depth, mat4 inverseProjectionMatrix, mat4 cameraMatrixWorld) {
    vec4 ndc = vec4(
        (uv.x - 0.5) * 2.0,
        (uv.y - 0.5) * 2.0,
        (depth - 0.5) * 2.0,
        1.0);

    vec4 clip = inverseProjectionMatrix * ndc;
    vec4 view = cameraMatrixWorld * (clip / clip.w);

    return view.xyz;
}

#endif

void main() {
    ivec2 size = textureSize(inputTexture, 0);
    vec2 pxSize = vec2(float(size.x), float(size.y));

    vec2 unjitteredUv = vUv - jitter / pxSize;

    vec4 inputTexel = textureLod(inputTexture, unjitteredUv, 0.);

    vec4 accumulatedTexel;
    vec3 outputColor;

    // REPROJECT_START

    vec4 velocityTexel = textureLod(velocityTexture, vUv, 0.);

    bool isBackground = velocityTexel.b == 1.;

    vec2 velUv = velocityTexel.xy;
    vec2 reprojectedUv = vUv - velUv;

    vec2 lastVelUv = textureLod(lastVelocityTexture, reprojectedUv, 0.).xy;

    float velocityLength = length(lastVelUv - velUv);

    // idea from: https://www.elopezr.com/temporal-aa-and-the-quest-for-the-holy-trail/
    float velocityDisocclusion = (velocityLength - 0.000001) * 10.;
    // velocityDisocclusion *= velocityDisocclusion;

#ifdef DILATION
    velUv = getVelocity(velocityTexture, vUv, pxSize);
    reprojectedUv = vUv - velUv;
#endif

    vec3 averageNeighborColor;

    bool didReproject = true;

    float movement = length(velUv) * 100.;

    float alpha;

    // check if reprojecting is necessary (due to movement) and that the reprojected UV is valid
    if (reprojectedUv.x >= 0. && reprojectedUv.x <= 1. && reprojectedUv.y >= 0. && reprojectedUv.y <= 1.) {
        accumulatedTexel = textureLod(accumulatedTexture, reprojectedUv, 0.);

        alpha = min(inputTexel.a, accumulatedTexel.a);

        // neighborhood clamping (only if needed)
        if (isBackground || alpha < 1.) {
            vec2 px = 1. / pxSize;

            // get neighbor pixels
            vec3 c02 = textureLod(inputTexture, unjitteredUv + vec2(-px.x, px.y), 0.).rgb;
            vec3 c12 = textureLod(inputTexture, unjitteredUv + vec2(0., px.y), 0.).rgb;
            vec3 c22 = textureLod(inputTexture, unjitteredUv + vec2(px.x, px.y), 0.).rgb;
            vec3 c01 = textureLod(inputTexture, unjitteredUv + vec2(-px.x, 0.), 0.).rgb;
            vec3 c11 = inputTexel.rgb;
            vec3 c21 = textureLod(inputTexture, unjitteredUv + vec2(px.x, 0.), 0.).rgb;
            vec3 c00 = textureLod(inputTexture, unjitteredUv + vec2(-px.x, -px.y), 0.).rgb;
            vec3 c10 = textureLod(inputTexture, unjitteredUv + vec2(0., -px.y), 0.).rgb;
            vec3 c20 = textureLod(inputTexture, unjitteredUv + vec2(px.x, -px.y), 0.).rgb;

            vec3 minNeighborColor = min9(c02, c12, c22, c01, c11, c21, c00, c10, c20);
            vec3 maxNeighborColor = max9(c02, c12, c22, c01, c11, c21, c00, c10, c20);

            vec3 clampedColor = clamp(accumulatedTexel.rgb, minNeighborColor, maxNeighborColor);

            accumulatedTexel.rgb = mix(accumulatedTexel.rgb, clampedColor, correction);
        }

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