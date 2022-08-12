// a basic shader to implement temporal resolving

uniform sampler2D inputTexture;
uniform sampler2D accumulatedTexture;

#ifdef USE_VELOCITY
uniform sampler2D velocityTexture;
#endif

#ifdef USE_LAST_VELOCITY
uniform sampler2D lastVelocityTexture;
#endif

uniform vec2 invTexSize;

varying vec2 vUv;

#include <packing>

#ifdef DILATION
// source: https://www.elopezr.com/temporal-aa-and-the-quest-for-the-holy-trail/ (modified to GLSL)
vec4 getDilatedTexture(sampler2D tex, vec2 uv, vec2 invTexSize) {
    float closestDepth = 0.;
    vec2 closestNeighborUv;
    vec2 neighborUv;
    float neighborDepth;

    for (int x = -1; x <= 1; x++) {
        for (int y = -1; y <= 1; y++) {
            neighborUv = vUv + vec2(x, y) * invTexSize;
            neighborDepth = textureLod(tex, neighborUv, 0.).b;

            if (neighborDepth > closestDepth) {
                closestNeighborUv = neighborUv;
                closestDepth = neighborDepth;
            }
        }
    }

    return textureLod(tex, closestNeighborUv, 0.);
}
#endif

const vec3 transformColorExponent = vec3(0.0625);
const vec3 undoColorTransformExponent = vec3(16.);

// idea from: https://www.elopezr.com/temporal-aa-and-the-quest-for-the-holy-trail/
vec3 transformColor(vec3 color) {
    return pow(color, transformColorExponent);
}

vec3 undoColorTransform(vec3 color) {
    return pow(color, undoColorTransformExponent);
}

void main() {
    ivec2 size = textureSize(inputTexture, 0);

    vec4 inputTexel = textureLod(inputTexture, vUv, 0.);

    vec3 inputColor = transformColor(inputTexel.rgb);
    vec3 accumulatedColor;
    vec3 outputColor;

    vec4 velocity;
    vec2 lastVelUv;

    // REPROJECT_START
#ifdef USE_VELOCITY
    #ifdef DILATION
    velocity = getDilatedTexture(velocityTexture, vUv, invTexSize);
    #else
    velocity = textureLod(velocityTexture, vUv, 0.);
    #endif
#endif

    vec2 velUv = velocity.xy;
    vec2 reprojectedUv = vUv - velUv;
    float velocityLength = length(lastVelUv - velUv);

#ifdef USE_LAST_VELOCITY
    #ifdef DILATION
    lastVelUv = getDilatedTexture(lastVelocityTexture, reprojectedUv, invTexSize).xy;
    #else
    lastVelUv = textureLod(lastVelocityTexture, reprojectedUv, 0.).xy;
    #endif
#endif

    // idea from: https://www.elopezr.com/temporal-aa-and-the-quest-for-the-holy-trail/
    float velocityDisocclusion = (velocityLength - 0.000001) * 10.;
    float movement = length(velUv) * 100.;
    bool isMoving = velocityDisocclusion > 0.001 || movement > 0.001;

    float alpha;

    // check if reprojecting is necessary (due to movement) and that the reprojected UV is valid
    if (reprojectedUv.x >= 0. && reprojectedUv.x <= 1. && reprojectedUv.y >= 0. && reprojectedUv.y <= 1.) {
        vec4 accumulatedTexel = textureLod(accumulatedTexture, reprojectedUv, 0.);
        alpha = min(inputTexel.a, accumulatedTexel.a);

#ifdef USE_VELOCITY
        if (!isMoving && alpha == 1.) {
            gl_FragColor = accumulatedTexel;
            return;
        }
#endif

        accumulatedColor = transformColor(accumulatedTexel.rgb);

        bool isBackground = velocity.b == 0.;

        // neighborhood clamping (only if needed)
        if (alpha < 1. || isMoving || isBackground) {
            vec3 minNeighborColor = inputColor;
            vec3 maxNeighborColor = inputColor;

            vec2 neighborUv;
            vec3 col;

            for (int x = -CLAMP_RADIUS; x <= CLAMP_RADIUS; x++) {
                for (int y = -CLAMP_RADIUS; y <= CLAMP_RADIUS; y++) {
                    if (x != 0 || y != 0) {
                        neighborUv = vUv + vec2(x, y) * invTexSize;

                        col = textureLod(inputTexture, neighborUv, 0.).xyz;
                        col = transformColor(col);

                        minNeighborColor = min(col, minNeighborColor);
                        maxNeighborColor = max(col, maxNeighborColor);
                    }
                }
            }

            accumulatedColor = clamp(accumulatedColor, minNeighborColor, maxNeighborColor);
        }

    } else {
        // reprojected UV coordinates are outside of screen, so just use the current frame for it
        accumulatedColor = inputColor;
    }

    // REPROJECT_END

// the user's shader to compose a final outputColor from the inputTexel and accumulatedTexel
#include <custom_compose_shader>

#define RENDER_MODE 0

#if RENDER_MODE == 1
    outputColor = velocity.bbb;
#endif

#if RENDER_MODE == 2
    outputColor = vec3(velocity.rg, 0.);
#endif

#if RENDER_MODE == 3
    outputColor = vec3(alpha);
#endif

#if RENDER_MODE == 4
    outputColor = vec3(velocityDisocclusion * velocityDisocclusion * 10000., 0., 0.);
#endif

    gl_FragColor = vec4(outputColor, alpha);
}