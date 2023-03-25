import { Pass } from "postprocessing"
import {
	ClampToEdgeWrapping,
	DataTexture,
	EquirectangularReflectionMapping,
	FloatType,
	LinearMipMapLinearFilter,
	NoBlending,
	RGBAFormat,
	ShaderMaterial,
	WebGLRenderTarget
} from "three"
import basicVertexShader from "../../utils/shader/basic.vert"

export class CubeToEquirectEnvPass extends Pass {
	constructor() {
		super("CubeToEquirectEnvPass")

		this.renderTarget = new WebGLRenderTarget(1, 1, { depthBuffer: false, type: FloatType })

		this.fullscreenMaterial = new ShaderMaterial({
			fragmentShader: /* glsl */ `
            varying vec2 vUv;
			uniform samplerCube cubeMap;

			#define M_PI 3.1415926535897932384626433832795
			
			// source: https://github.com/spite/CubemapToEquirectangular/blob/master/src/CubemapToEquirectangular.js
            void main() {
				float longitude = vUv.x * 2. * M_PI - M_PI + M_PI / 2.;
				float latitude = vUv.y * M_PI;

				vec3 dir = vec3(
					- sin( longitude ) * sin( latitude ),
					cos( latitude ),
					- cos( longitude ) * sin( latitude )
				);

				dir.y = -dir.y;

				gl_FragColor = textureCube( cubeMap, dir );
            }
            `,
			vertexShader: basicVertexShader,
			uniforms: {
				cubeMap: { value: null }
			},
			blending: NoBlending,
			depthWrite: false,
			depthTest: false,
			toneMapped: false
		})
	}

	dispose() {
		this.renderTarget.dispose()
	}

	generateEquirectEnvMap(renderer, cubeMap, width = null, height = null, maxWidth = 4096) {
		if (width === null && height === null) {
			const w = cubeMap.source.data[0].width
			const widthEquirect = 2 ** Math.ceil(Math.log2(2 * w * 3 ** 0.5))
			const heightEquirect = 2 ** Math.ceil(Math.log2(w * 3 ** 0.5))

			width = widthEquirect
			height = heightEquirect
		}

		if (width > maxWidth) {
			width = maxWidth
			height = maxWidth / 2
		}

		this.renderTarget.setSize(width, height)
		this.fullscreenMaterial.uniforms.cubeMap.value = cubeMap

		const { renderTarget } = this

		renderer.setRenderTarget(renderTarget)
		renderer.render(this.scene, this.camera)

		// Create a new Float32Array to store the pixel data
		const pixelBuffer = new Float32Array(width * height * 4)
		renderer.readRenderTargetPixels(renderTarget, 0, 0, width, height, pixelBuffer)

		// Create a new data texture
		const equirectEnvMap = new DataTexture(pixelBuffer, width, height, RGBAFormat, FloatType)

		// Set texture options
		equirectEnvMap.wrapS = ClampToEdgeWrapping
		equirectEnvMap.wrapT = ClampToEdgeWrapping
		equirectEnvMap.minFilter = LinearMipMapLinearFilter
		equirectEnvMap.magFilter = LinearMipMapLinearFilter
		equirectEnvMap.needsUpdate = true

		equirectEnvMap.mapping = EquirectangularReflectionMapping

		return equirectEnvMap
	}
}
