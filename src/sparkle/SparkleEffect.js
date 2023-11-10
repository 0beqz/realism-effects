import { Effect } from "postprocessing"
import { setupBlueNoise } from "../utils/BlueNoiseUtils"
import gbuffer_packing from "../gbuffer/shader/gbuffer_packing.glsl"

const fragShader = /* glsl */ `
    #define luminance(c) dot(c.rgb, vec3(0.299, 0.587, 0.114))

    ${gbuffer_packing}

    uniform sampler2D velocityTexture;
    uniform mat4 projectionMatrix;
    uniform mat4 projectionMatrixInverse;
    uniform mat4 viewMatrix;
    uniform mat4 cameraMatrixWorld;
    uniform vec3 backgroundColor;
    uniform float spread;
    uniform float intensity;

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

    float nn(vec2 n) {
        const vec2 d = vec2(0.0, 1.0);
        vec2 b = floor(n), f = smoothstep(vec2(0.0), vec2(1.0), fract(n));
        return mix(mix(rand(b), rand(b + d.yx), f.x), mix(rand(b + d.xy), rand(b + d.yy), f.x), f.y);
    }

    void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec4 velocityTexel = textureLod(velocityTexture, uv, 0.0);

        float depth = velocityTexel.a;

        if(depth == 0. || depth == 1.) {
            outputColor = inputColor;
            return;
        }

        vec3 normal = unpackNormal(velocityTexel.b);
        vec3 viewNormal = normalize((viewMatrix * vec4(normal, 0.)).xyz);

        // get the world position from the depth texture
        float viewZ = getViewZ(depth);
        // view-space position of the current texel
        vec3 viewPos = getViewPosition(viewZ);
        vec3 viewDir = normalize(viewPos);
        vec3 worldPos = (cameraMatrixWorld * vec4(viewPos, 1.)).xyz;

        if(worldPos.y < 0.01){
            outputColor = inputColor;
            return;
        }

        vec3 cameraPos = (cameraMatrixWorld * vec4(0., 0., 0., 1.)).xyz;

        float dist = length(worldPos - cameraPos);
        float distFactor = exp(-dist * 0.005);

        // using world normal and world position, determine how much the surface is facing the camera
        float facing = max(dot(-viewDir, viewNormal), 0.);
        facing = pow(facing, 4.);
        
        // facing = mix(facing, bn, 0.1);

        vec2 offset = normalize(worldPos).xz * 1000. + normal.xz * 500.;

        float noise = nn(offset);
        noise = pow(noise, 500. * spread);

        float lum = luminance(inputColor.rgb);
        lum = smoothstep(0.15, 1., lum);

        float sparkleFactor = noise * lum * facing * distFactor * 5000. * intensity;

        vec3 color = inputColor.rgb + pow(inputColor.rgb, vec3(4.)) * sparkleFactor;
        outputColor = vec4(color, 1.);
    }
`
export class SparkleEffect extends Effect {
	constructor(camera, velocityDepthNormalPass) {
		const { uniforms, fragmentShader } = setupBlueNoise(fragShader)

		// convert uniforms, so we can pass them to Map
		const uniformsMap = new Map()
		Object.entries(uniforms).forEach(([key, value]) => {
			uniformsMap.set(key, value)
		})

		super("SparkleEffect", fragmentShader, {
			uniforms: new Map([
				["projectionMatrix", { value: camera.projectionMatrix.clone() }],
				["projectionMatrixInverse", { value: camera.projectionMatrixInverse.clone() }],
				["cameraMatrixWorld", { value: camera.matrixWorld }],
				["viewMatrix", { value: camera.matrixWorldInverse }],
				["velocityTexture", { value: velocityDepthNormalPass.texture }],
				["spread", { value: 1 }],
				["intensity", { value: 1 }],
				...uniformsMap
			])
		})

		this._camera = camera
	}

	update() {
		const { view } = this._camera
		view && this._camera.clearViewOffset()

		this.uniforms.get("projectionMatrix").value.copy(this._camera.projectionMatrix)
		this.uniforms.get("projectionMatrixInverse").value.copy(this._camera.projectionMatrixInverse)

		view &&
			this._camera.setViewOffset(view.fullWidth, view.fullHeight, view.offsetX, view.offsetY, view.width, view.height)
	}

	setSpread(spread) {
		this.uniforms.get("spread").value = spread
	}

	setIntensity(intensity) {
		this.uniforms.get("intensity").value = intensity
	}
}
