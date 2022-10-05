import { Pass } from "postprocessing"
import { HalfFloatType, NearestFilter, ShaderMaterial, Uniform, Vector2, WebGLRenderTarget } from "three"
import basicVertexShader from "../shader/basic.vert"

export class UpscalePass extends Pass {
	constructor({ horizontal } = { horizontal: true }) {
		super("UpscalePass")

		this.fullscreenMaterial = new ShaderMaterial({
			fragmentShader: /* glsl */ `
            varying vec2 vUv;

            uniform sampler2D inputTexture;
            uniform sampler2D depthTexture;
            uniform sampler2D normalTexture;
            uniform vec2 invTexSize;
            uniform float sharpness;
            uniform float blurKernel;
            uniform float jitter;
            uniform float jitterRoughness;

            #include <packing>

            void main() {
                vec4 depthTexel = textureLod(depthTexture, vUv, 0.);

                // skip background
                if(dot(depthTexel.rgb, depthTexel.rgb) == 0.){
                    return;
                }

                float depth = unpackRGBAToDepth(depthTexel);

                // vec2 bestUv;
                float totalWeight = 1.;

                // const float maxDepthDifference = 0.0001;
                const float maxDepthDifference = 0.000025;

                vec4 inputTexel = textureLod(inputTexture, vUv, 0.);
                vec3 color = inputTexel.rgb;

                float roughness = textureLod(normalTexture, vUv, 0.).a;

                float roughnessFactor = min(1., jitterRoughness * roughness + jitter);

                float kernel = floor((blurKernel + 2.0) * roughnessFactor);

                if(kernel == 0.){
                    gl_FragColor = vec4(color, inputTexel.a);
                    return;
                }
                
                for(float i = -kernel; i <= kernel; i++){
                    if(i != 0.){
                        #ifdef horizontal
                        vec2 neighborVec = vec2(i, 0.);
                        #else
                        vec2 neighborVec = vec2(0., i);
                        #endif
                        vec2 neighborUv = vUv + neighborVec * invTexSize;

                        if (all(greaterThanEqual(neighborUv, vec2(0.))) && all(lessThanEqual(neighborUv, vec2(1.)))) {
                            float neighborDepth = unpackRGBAToDepth(textureLod(depthTexture, neighborUv, 0.));

                            float depthDiff = abs(depth - neighborDepth);
                            depthDiff /= maxDepthDifference;
                            if(depthDiff > 1.) depthDiff = 1.;

                            float weight = 1. - depthDiff;
                            weight = pow(weight, sharpness);

                            if(true){
                                // bestUv += neighborUv * weight;
                                totalWeight += weight;

                                color += textureLod(inputTexture, neighborUv, 0.).rgb * weight;
                            }
                        }
                    }
                }
                
                color /= totalWeight;

                // bestUv /= totalWeight;
                // bestUv -= vUv;
                // bestUv *= 1000.;
                // color = bestUv.xyx;

                gl_FragColor = vec4(color, inputTexel.a);
            }
            `,
			vertexShader: basicVertexShader,
			uniforms: {
				inputTexture: new Uniform(null),
				depthTexture: new Uniform(null),
				normalTexture: new Uniform(null),
				invTexSize: new Uniform(new Vector2()),
				blurKernel: new Uniform(3),
				sharpness: new Uniform(32),
				jitter: new Uniform(0),
				jitterRoughness: new Uniform(0)
			}
		})

		if (horizontal) {
			this.fullscreenMaterial.defines.horizontal = ""
		}

		this.renderTarget = new WebGLRenderTarget(1, 1, {
			minFilter: NearestFilter,
			magFilter: NearestFilter,
			type: HalfFloatType,
			depthBuffer: false
		})
	}

	setSize(width, height) {
		this.renderTarget.setSize(width, height)
	}

	render(renderer) {
		renderer.setRenderTarget(this.renderTarget)
		renderer.render(this.scene, this.camera)
	}
}

export const upscaleFXAA = /* glsl */ `
// source: https://github.com/CesiumGS/cesium/blob/main/Source/Shaders/Builtin/Functions/luminance.glsl
float luminance(vec3 rgb) {
    // Algorithm from Chapter 10 of Graphics Shaders.
    const vec3 W = vec3(0.2125, 0.7154, 0.0721);
    return dot(rgb, W);
}

#define QUALITY(q)         ((q) < 5 ? 1.0 : ((q) > 5 ? ((q) < 10 ? 2.0 : ((q) < 11 ? 4.0 : 8.0)) : 1.5))
#define ONE_OVER_TWELVE    0.08333333333333333
#define EDGE_THRESHOLD_MIN 0.
#define EDGE_THRESHOLD_MAX 1.
#define SUBPIXEL_QUALITY   6.
#define SAMPLES            24

vec4 fxaa(const in vec4 inputColor, const in vec2 uv) {
    vec2 vUvDownLeft;
    vec2 vUvUpRight;
    vec2 vUvUpLeft;
    vec2 vUvDownRight;

    vec2 vUvDown;
    vec2 vUvUp;
    vec2 vUvLeft;
    vec2 vUvRight;

    vUvDown = uv + vec2(0.0, -1.0) * invTexSize;
    vUvUp = uv + vec2(0.0, 1.0) * invTexSize;
    vUvRight = uv + vec2(1.0, 0.0) * invTexSize;
    vUvLeft = uv + vec2(-1.0, 0.0) * invTexSize;

    vUvDownLeft = uv + vec2(-1.0, -1.0) * invTexSize;
    vUvUpRight = uv + vec2(1.0, 1.0) * invTexSize;
    vUvUpLeft = uv + vec2(-1.0, 1.0) * invTexSize;
    vUvDownRight = uv + vec2(1.0, -1.0) * invTexSize;

    // Luma at the current fragment.
    float lumaCenter = luminance(inputColor.rgb);

    // Luma at the four direct neighbours of the current fragment.
    float lumaDown = luminance(texture2D(inputTexture, vUvDown).rgb);
    float lumaUp = luminance(texture2D(inputTexture, vUvUp).rgb);
    float lumaLeft = luminance(texture2D(inputTexture, vUvLeft).rgb);
    float lumaRight = luminance(texture2D(inputTexture, vUvRight).rgb);

    // Find the maximum and minimum luma around the current fragment.
    float lumaMin = min(lumaCenter, min(min(lumaDown, lumaUp), min(lumaLeft, lumaRight)));
    float lumaMax = max(lumaCenter, max(max(lumaDown, lumaUp), max(lumaLeft, lumaRight)));

    // Compute the delta.
    float lumaRange = lumaMax - lumaMin;

    // Query the 4 remaining corners lumas.
    float lumaDownLeft = luminance(texture2D(inputTexture, vUvDownLeft).rgb);
    float lumaUpRight = luminance(texture2D(inputTexture, vUvUpRight).rgb);
    float lumaUpLeft = luminance(texture2D(inputTexture, vUvUpLeft).rgb);
    float lumaDownRight = luminance(texture2D(inputTexture, vUvDownRight).rgb);

    // Combine the four edges lumas (using intermediary variables for future computations with the same values).
    float lumaDownUp = lumaDown + lumaUp;
    float lumaLeftRight = lumaLeft + lumaRight;

    // Same for corners.
    float lumaLeftCorners = lumaDownLeft + lumaUpLeft;
    float lumaDownCorners = lumaDownLeft + lumaDownRight;
    float lumaRightCorners = lumaDownRight + lumaUpRight;
    float lumaUpCorners = lumaUpRight + lumaUpLeft;

    // Compute an estimation of the gradient along the horizontal and vertical axis.
    float edgeHorizontal = (abs(-2.0 * lumaLeft + lumaLeftCorners) +
                            abs(-2.0 * lumaCenter + lumaDownUp) * 2.0 +
                            abs(-2.0 * lumaRight + lumaRightCorners));

    float edgeVertical = (abs(-2.0 * lumaUp + lumaUpCorners) +
                          abs(-2.0 * lumaCenter + lumaLeftRight) * 2.0 +
                          abs(-2.0 * lumaDown + lumaDownCorners));

    // Check if the local edge is horizontal or vertical.
    bool isHorizontal = (edgeHorizontal >= edgeVertical);

    // Choose the step size (one pixel) accordingly.
    float stepLength = isHorizontal ? invTexSize.y : invTexSize.x;

    // Select the two neighboring texels' lumas in the opposite direction to the local edge.
    float luma1 = isHorizontal ? lumaDown : lumaLeft;
    float luma2 = isHorizontal ? lumaUp : lumaRight;

    // Compute gradients in this direction.
    float gradient1 = abs(luma1 - lumaCenter);
    float gradient2 = abs(luma2 - lumaCenter);

    // Check which direction is the steepest.
    bool is1Steepest = gradient1 >= gradient2;

    // Gradient in the corresponding direction, normalized.
    float gradientScaled = 0.25 * max(gradient1, gradient2);

    // Average luma in the correct direction.
    float lumaLocalAverage = 0.0;

    if (is1Steepest) {
        // Switch the direction.
        stepLength = -stepLength;
        lumaLocalAverage = 0.5 * (luma1 + lumaCenter);

    } else {
        lumaLocalAverage = 0.5 * (luma2 + lumaCenter);
    }

    // Shift UV in the correct direction by half a pixel.
    vec2 currentUv = uv;

    if (isHorizontal) {
        currentUv.y += stepLength * 0.5;

    } else {
        currentUv.x += stepLength * 0.5;
    }

    // Compute offset (for each iteration step) in the right direction.
    vec2 offset = isHorizontal ? vec2(invTexSize.x, 0.0) : vec2(0.0, invTexSize.y);

    // Compute UVs to explore on each side of the edge, orthogonally. The QUALITY allows us to step faster.
    vec2 uv1 = currentUv - offset * QUALITY(0);
    vec2 uv2 = currentUv + offset * QUALITY(0);

    // Read lumas at both extremities of the exploration segment, and compute the delta w.r.t. the local average luma.
    float lumaEnd1 = luminance(texture2D(inputTexture, uv1).rgb);
    float lumaEnd2 = luminance(texture2D(inputTexture, uv2).rgb);
    lumaEnd1 -= lumaLocalAverage;
    lumaEnd2 -= lumaLocalAverage;

    // If the deltas at the current extremities are larger than the local gradient, the side of the edge has been reached.
    bool reached1 = abs(lumaEnd1) >= gradientScaled;
    bool reached2 = abs(lumaEnd2) >= gradientScaled;
    bool reachedBoth = reached1 && reached2;

    // If the side has not been reached, continue to explore in this direction.
    if (!reached1) {
        uv1 -= offset * QUALITY(1);
    }

    if (!reached2) {
        uv2 += offset * QUALITY(1);
    }

    // If both sides have not been reached, continue to explore.
    if (!reachedBoth) {
        for (int i = 2; i < SAMPLES; ++i) {
            // If needed, read luma in 1st direction, compute delta.
            if (!reached1) {
                lumaEnd1 = luminance(texture2D(inputTexture, uv1).rgb);
                lumaEnd1 = lumaEnd1 - lumaLocalAverage;
            }

            // If needed, read luma in opposite direction, compute delta.
            if (!reached2) {
                lumaEnd2 = luminance(texture2D(inputTexture, uv2).rgb);
                lumaEnd2 = lumaEnd2 - lumaLocalAverage;
            }

            // If the deltas are larger than the local gradient, the side of the edge has been reached.
            reached1 = abs(lumaEnd1) >= gradientScaled;
            reached2 = abs(lumaEnd2) >= gradientScaled;
            reachedBoth = reached1 && reached2;

            // If the side has not been reached, continue to explore in this direction, with dynamic quality.
            if (!reached1) {
                uv1 -= offset * QUALITY(i);
            }

            if (!reached2) {
                uv2 += offset * QUALITY(i);
            }

            // If both sides have been reached, stop the exploration.
            if (reachedBoth) {
                break;
            }
        }
    }

    // Compute the distances to each side edge of the edge (!).
    float distance1 = isHorizontal ? (uv.x - uv1.x) : (uv.y - uv1.y);
    float distance2 = isHorizontal ? (uv2.x - uv.x) : (uv2.y - uv.y);

    // Check in which direction the side of the edge is closer.
    bool isDirection1 = distance1 < distance2;
    float distanceFinal = min(distance1, distance2);

    // Thickness of the edge.
    float edgeThickness = (distance1 + distance2);

    // Check if the luma at the center is smaller than the local average.
    bool isLumaCenterSmaller = lumaCenter < lumaLocalAverage;

    // If the luma is smaller than at its neighbour, the delta luma at each end should be positive (same variation).
    bool correctVariation1 = (lumaEnd1 < 0.0) != isLumaCenterSmaller;
    bool correctVariation2 = (lumaEnd2 < 0.0) != isLumaCenterSmaller;

    // Only keep the result in the direction of the closer side of the edge.
    bool correctVariation = isDirection1 ? correctVariation1 : correctVariation2;

    // UV offset: read in the direction of the closest side of the edge.
    float pixelOffset = -distanceFinal / edgeThickness + 0.5;

    // If the luma variation is incorrect, do not offset.
    float finalOffset = correctVariation ? pixelOffset : 0.0;

    // Sub-Pixel Shifting
    // Full weighted average of the luma over the 3x3 neighborhood.
    float lumaAverage = ONE_OVER_TWELVE * (2.0 * (lumaDownUp + lumaLeftRight) + lumaLeftCorners + lumaRightCorners);
    // Ratio of the delta between the global average and the center luma, over the luma range in the 3x3 neighborhood.
    float subPixelOffset1 = clamp(abs(lumaAverage - lumaCenter) / lumaRange, 0.0, 1.0);
    float subPixelOffset2 = (-2.0 * subPixelOffset1 + 3.0) * subPixelOffset1 * subPixelOffset1;
    // Compute a sub-pixel offset based on this delta.
    float subPixelOffsetFinal = subPixelOffset2 * subPixelOffset2 * SUBPIXEL_QUALITY;

    // Pick the biggest of the two offsets.
    finalOffset = max(finalOffset, subPixelOffsetFinal);

    // Compute the final UV coordinates.
    vec2 finalUv = uv;

    if (isHorizontal) {
        finalUv.y += finalOffset * stepLength;

    } else {
        finalUv.x += finalOffset * stepLength;
    }

    return texture2D(inputTexture, finalUv);
}
`
