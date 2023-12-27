import { AOPass } from "../ao/AOPass"
// eslint-disable-next-line camelcase
import fragmentShader from "./shader/gtao.frag"

class GTAOPass extends AOPass {
	constructor(camera, scene, depthTexture) {
		super(camera, scene, depthTexture, fragmentShader)
	}
}

export { GTAOPass }
