import { Effect } from "postprocessing"

// create a postprocessing.js effect class with all the required methods such as update()
export class GradualBackgroundEffect extends Effect {
	constructor(camera, depthTexture, backgroundColor, maxDistance = 5) {
		const fragmentShader = /* glsl */ `
        uniform sampler2D depthTexture;
        uniform mat4 projectionMatrix;
        uniform mat4 projectionMatrixInverse;
        uniform mat4 cameraMatrixWorld;
        uniform vec3 backgroundColor;
        uniform float maxDistance;

        // source: https://github.com/mrdoob/three.js/blob/79ea10830dfc97b6c0a7e29d217c7ff04c081095/examples/jsm/shaders/BokehShader.js#L66
        float getViewZ(const in float depth) {
            #if PERSPECTIVE_CAMERA == 1
            return perspectiveDepthToViewZ(depth, cameraNear, cameraFar);
            #else
            return orthographicDepthToViewZ(depth, cameraNear, cameraFar);
            #endif
        }

        // source:
        // https://github.com/mrdoob/three.js/blob/dev/examples/js/shaders/SSAOShader.js
        vec3 getViewPosition(float viewZ) {
            float clipW = projectionMatrix[2][3] * viewZ + projectionMatrix[3][3];
            vec4 clipPosition = vec4((vec3(vUv, viewZ) - 0.5) * 2.0, 1.0);
            clipPosition *= clipW;
            vec3 p = (projectionMatrixInverse * clipPosition).xyz;
            p.z = viewZ;
            return p;
        }

        void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
            float depth = textureLod(depthTexture, uv, 0.).r;

            // get the world position from the depth texture
            float viewZ = getViewZ(depth);
            // view-space position of the current texel
            vec3 viewPos = getViewPosition(viewZ);
            vec3 worldPos = (cameraMatrixWorld * vec4(viewPos, 1.)).xyz;
            float distToCenter = length(worldPos.xz) + max(0., -worldPos.y);
            float fade = clamp(pow(distToCenter, 0.1) * 15.0 - maxDistance, 0., 1.);

            vec3 color = mix(inputColor.rgb, backgroundColor, fade);

            outputColor = vec4(color, 1.);
        }
        `

		super("GradualBackgroundEffect", fragmentShader, {
			uniforms: new Map([
				["projectionMatrix", { value: camera.projectionMatrix }],
				["projectionMatrixInverse", { value: camera.projectionMatrixInverse }],
				["cameraMatrixWorld", { value: camera.matrixWorld }],
				["depthTexture", { value: depthTexture }],
				["backgroundColor", { value: backgroundColor }],
				["maxDistance", { value: maxDistance }]
			]),
			defines: new Map([["PERSPECTIVE_CAMERA", camera.isPerspectiveCamera ? "1" : "0"]])
		})
	}

	setBackgroundColor(color) {
		this.uniforms.get("backgroundColor").value = color
	}

	setMaxDistance(distance) {
		this.uniforms.get("maxDistance").value = distance
	}
}
