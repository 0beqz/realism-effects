import { DepthPass, Pass, RenderPass } from "postprocessing"
import { HalfFloatType, LinearFilter, NearestFilter, WebGLMultipleRenderTargets, WebGLRenderTarget } from "three"
import { MRTMaterial } from "../material/MRTMaterial.js"
import { ReflectionsMaterial } from "../material/ReflectionsMaterial.js"
import { getVisibleChildren } from "../utils/Utils.js"
import { DownsamplingPass } from "./DownsamplingPass.js"

// from https://github.com/mrdoob/three.js/blob/dev/examples/jsm/capabilities/WebGL.js#L18
const isWebGL2Available = () => {
	try {
		const canvas = document.createElement("canvas")
		return !!(window.WebGL2RenderingContext && canvas.getContext("webgl2"))
	} catch (e) {
		return false
	}
}

export class ReflectionsPass extends Pass {
	ssrEffect
	cachedMaterials = new WeakMap()
	isWebGL2 = false
	webgl1DepthPass = null
	visibleMeshes = []

	constructor(ssrEffect) {
		super("ReflectionsPass")

		this.ssrEffect = ssrEffect
		this._scene = ssrEffect._scene
		this._camera = ssrEffect._camera

		this.useDiffuse = true

		this.fullscreenMaterial = new ReflectionsMaterial()
		if (ssrEffect._camera.isPerspectiveCamera) this.fullscreenMaterial.defines.PERSPECTIVE_CAMERA = ""

		this.renderTarget = new WebGLRenderTarget(1, 1, {
			minFilter: NearestFilter,
			magFilter: NearestFilter,
			type: HalfFloatType,
			depthBuffer: false
		})

		this.renderPass = new RenderPass(this._scene, this._camera)

		this.isWebGL2 = isWebGL2Available()

		if (this.isWebGL2) {
			// buffers: normal, depth (2), roughness will be written to the alpha channel of the normal buffer
			this.gBuffersRenderTarget = new WebGLMultipleRenderTargets(1, 1, this.useDiffuse ? 3 : 2, {
				minFilter: NearestFilter,
				magFilter: NearestFilter
			})

			this.normalTexture = this.gBuffersRenderTarget.texture[0]
			this.depthTexture = this.gBuffersRenderTarget.texture[1]
		} else {
			// depth pass
			this.webgl1DepthPass = new DepthPass(this._scene, this._camera)

			// render normals (in the rgb channel) and roughness (in the alpha channel) in gBuffersRenderTarget
			this.gBuffersRenderTarget = new WebGLRenderTarget(1, 1, {
				minFilter: NearestFilter,
				magFilter: NearestFilter
			})

			this.normalTexture = this.gBuffersRenderTarget.texture
			this.depthTexture = this.webgl1DepthPass.texture
		}

		this.downsamplingPass = new DownsamplingPass(this.depthTexture, this.normalTexture)
		this.downsampling = false

		// set up uniforms
		this.fullscreenMaterial.uniforms.normalTexture.value = this.normalTexture
		this.fullscreenMaterial.uniforms.fullResDepthTexture.value = this.depthTexture
		this.fullscreenMaterial.uniforms.cameraMatrixWorld.value = this._camera.matrixWorld
		this.fullscreenMaterial.uniforms._projectionMatrix.value = this._camera.projectionMatrix
		this.fullscreenMaterial.uniforms._inverseProjectionMatrix.value = this._camera.projectionMatrixInverse

		if (this.useDiffuse) this.fullscreenMaterial.uniforms.diffuseTexture.value = this.gBuffersRenderTarget.texture[2]
	}

	setSize(width, height) {
		this.renderTarget.setSize(width * this.ssrEffect.resolutionScale, height * this.ssrEffect.resolutionScale)
		if (this.ssrEffect.resolutionScale < 0.5) {
			this.renderTarget.texture.minFilter = LinearFilter
			this.renderTarget.texture.magFilter = LinearFilter
		} else {
			this.renderTarget.texture.minFilter = NearestFilter
			this.renderTarget.texture.magFilter = NearestFilter
		}

		this.gBuffersRenderTarget.setSize(width * this.ssrEffect.qualityScale, height * this.ssrEffect.qualityScale)
		this.downsamplingPass.setSize(width * 0.5, height * 0.5)

		this.fullscreenMaterial.uniforms.invTexSize.value.set(1 / width, 1 / height)

		this.fullscreenMaterial.uniforms.accumulatedTexture.value = this.ssrEffect.temporalResolvePass.renderTarget.texture
		this.fullscreenMaterial.uniforms.depthTexture.value =
			this.downsampling && this.ssrEffect.qualityScale < 1
				? this.downsamplingPass.renderTarget.texture[0]
				: this.depthTexture

		this.fullscreenMaterial.needsUpdate = true
	}

	dispose() {
		this.renderTarget.dispose()
		this.gBuffersRenderTarget.dispose()
		this.renderPass.dispose()
		if (!this.isWebGL2) this.webgl1DepthPass.dispose()

		this.fullscreenMaterial.dispose()

		this.normalTexture = null
		this.depthTexture = null
		this.velocityTexture = null
	}

	keepMaterialMapUpdated(mrtMaterial, originalMaterial, prop, define) {
		if (this.ssrEffect[define]) {
			if (originalMaterial[prop] !== mrtMaterial[prop]) {
				mrtMaterial[prop] = originalMaterial[prop]
				mrtMaterial.uniforms[prop].value = originalMaterial[prop]

				if (originalMaterial[prop]) {
					mrtMaterial.defines[define] = ""
				} else {
					delete mrtMaterial.defines[define]
				}

				mrtMaterial.needsUpdate = true
			}
		} else if (mrtMaterial[prop] !== undefined) {
			mrtMaterial[prop] = undefined
			mrtMaterial.uniforms[prop].value = undefined
			delete mrtMaterial.defines[define]
			mrtMaterial.needsUpdate = true
		}
	}

	setMRTMaterialInScene() {
		this.visibleMeshes = getVisibleChildren(this._scene)

		for (const c of this.visibleMeshes) {
			if (c.material) {
				const originalMaterial = c.material

				let [cachedOriginalMaterial, mrtMaterial] = this.cachedMaterials.get(c) || []

				if (originalMaterial !== cachedOriginalMaterial) {
					if (mrtMaterial) mrtMaterial.dispose()

					mrtMaterial = new MRTMaterial()

					if (this.isWebGL2) mrtMaterial.defines.isWebGL2 = ""
					if (this.useDiffuse) mrtMaterial.defines.useDiffuse = ""

					mrtMaterial.normalScale = originalMaterial.normalScale
					mrtMaterial.uniforms.normalScale.value = originalMaterial.normalScale

					const map =
						originalMaterial.map ||
						originalMaterial.normalMap ||
						originalMaterial.roughnessMap ||
						originalMaterial.metalnessMap

					if (map) mrtMaterial.uniforms.uvTransform.value = map.matrix

					this.cachedMaterials.set(c, [originalMaterial, mrtMaterial])
				}

				// update the child's MRT material
				this.keepMaterialMapUpdated(mrtMaterial, originalMaterial, "normalMap", "USE_NORMAL_MAP")
				this.keepMaterialMapUpdated(mrtMaterial, originalMaterial, "roughnessMap", "USE_ROUGHNESS_MAP")
				this.keepMaterialMapUpdated(mrtMaterial, originalMaterial, "map", "USE_MAP")

				if (originalMaterial.color) mrtMaterial.uniforms.color.value.copy(originalMaterial.color)

				mrtMaterial.uniforms.roughness.value =
					this.ssrEffect.selection.size === 0 || this.ssrEffect.selection.has(c)
						? originalMaterial.roughness || 0
						: 10e10

				c.material = mrtMaterial
			}
		}
	}

	unsetMRTMaterialInScene() {
		for (const c of this.visibleMeshes) {
			if (c.material?.type === "MRTMaterial") {
				c.visible = true
				// set material back to the original one
				const [originalMaterial] = this.cachedMaterials.get(c)

				c.material = originalMaterial
			}
		}
	}

	render(renderer, inputBuffer) {
		this.setMRTMaterialInScene()

		renderer.setRenderTarget(this.gBuffersRenderTarget)
		this.renderPass.render(renderer, this.gBuffersRenderTarget)

		this.unsetMRTMaterialInScene()

		// render depth and velocity in seperate passes
		if (!this.isWebGL2) this.webgl1DepthPass.renderPass.render(renderer, this.webgl1DepthPass.renderTarget)

		if (this.downsampling && this.ssrEffect.qualityScale < 1) this.downsamplingPass.render(renderer, inputBuffer)

		this.fullscreenMaterial.uniforms.inputTexture.value = inputBuffer.texture
		this.fullscreenMaterial.uniforms.samples.value = this.ssrEffect.temporalResolvePass.samples
		this.fullscreenMaterial.uniforms.cameraNear.value = this._camera.near
		this.fullscreenMaterial.uniforms.cameraFar.value = this._camera.far

		this.fullscreenMaterial.uniforms.viewMatrix.value.copy(this._camera.matrixWorldInverse)

		renderer.setRenderTarget(this.renderTarget)
		renderer.render(this.scene, this.camera)
	}
}
