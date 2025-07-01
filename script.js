import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/0.170.0/three.module.min.js';
import { gsap } from 'https://cdn.skypack.dev/gsap';


const BASE_BLOCK_SIZE = {
  width: 10,
  height: 3,
  depth: 10,
};

const COLOR = {
  background: '#E1E4E6',
  baseBlock: '#1F2426',
  movingBlock: '#f753e6',
  placedBlock: '#0092E1',
  fallingBlock: '#f8f659',
};

let resizeTimeout;
const SPEED_FACTOR = 10;
const MOVING_RANGE = 15;

class BlockModel {
  constructor({
    width,
    height = BASE_BLOCK_SIZE.height,
    depth,
    initPosition = new THREE.Vector3(0, 0, 0),
    color = COLOR.movingBlock,
  }) {
    this.width = width;
    this.height = height;
    this.depth = depth;

    this.geometry = new THREE.BoxGeometry(this.width, this.height, this.depth);
    this.material = new THREE.MeshLambertMaterial({ color });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.position.set(...initPosition);
  }
}

const getLastBlockProps = (layer) => {
  return {
    width: layer.movingBlock.width,
    depth: layer.movingBlock.depth,
    initPosition: layer.movingBlock.mesh.position,
  };
}

const calcFallingPosition = (layer, axisPosition) => {
  const shift = axisPosition + layer.overlap / 2;

  return layer.isCuttingBehind ? shift - layer.overlap : shift;
};

const getFallingBlockProps = (layer) => {
  const props = {
    width: layer.isAxisX
      ? layer.movingBlock.width - layer.overlap
      : layer.movingBlock.width,
    depth: layer.isAxisZ
        ? layer.movingBlock.depth - layer.overlap
        : layer.movingBlock.depth,
  };

  const x = layer.isAxisX
    ? calcFallingPosition(layer, layer.movingBlock.mesh.position.x)
    : layer.movingBlock.mesh.position.x;

  const z = layer.isAxisZ
    ? calcFallingPosition(layer, layer.movingBlock.mesh.position.z)
    : layer.movingBlock.mesh.position.z;

  props.initPosition = new THREE.Vector3(
    x,
    layer.movingBlock.mesh.position.y,
    z
  );

  return props;
};

class FallingBlockModel extends BlockModel {
  constructor({
    layer,
    isLastFallingBlock
  }) {
    const props = isLastFallingBlock
      ? getLastBlockProps(layer)
      : getFallingBlockProps(layer);

    props.color = COLOR.fallingBlock;

    super(props)
  }

  tick(delta) {
    this.mesh.position.y -= delta * 25;
    this.mesh.rotation.x += delta * 2;
    this.mesh.rotation.z += delta * 1.5;
  }
}

const calcPlacedBlockShift = (sideSize, layer) => {
  const shift = (sideSize - layer.overlap) / 2;
  const sign = layer.isCuttingBehind ? 1 : -1;

  return shift * sign;
};

const calcPlacedBlockProps = (layer) => {
  const width = layer.isAxisX ? layer.overlap : layer.movingBlock.width;
  const depth = layer.isAxisZ ? layer.overlap : layer.movingBlock.depth;

  const x = layer.isAxisX
    ? layer.movingBlock.mesh.position.x + calcPlacedBlockShift(layer.movingBlock.width, layer)
    : layer.movingBlock.mesh.position.x;

  const z = layer.isAxisZ
    ? layer.movingBlock.mesh.position.z + calcPlacedBlockShift(layer.movingBlock.depth, layer)
    : layer.movingBlock.mesh.position.z;

  return {
    width,
    depth,
    initPosition: new THREE.Vector3(x, layer.movingBlock.mesh.position.y, z),
    color: COLOR.placedBlock,
  };
};

class PlacedBlockModel extends BlockModel {
  constructor(layer) {
    const props = calcPlacedBlockProps(layer);

    super(props);
  }
}

class LayerModel {
  fallingBlock = null;
  placedBlock = null;
  overlap = 0;
  isCuttingBehind = false;
  _initMovingBlockPosition = -MOVING_RANGE;

  constructor({
    scene,
    axis = 'x',
    width,
    depth,
    x = 0,
    y = 0,
    z = 0,
  }) {
    this._scene = scene;
    this.axis = axis;
    this.movingBlock = new BlockModel({
      width,
      depth,
      initPosition: new THREE.Vector3(
        this.isAxisX ? this._initMovingBlockPosition : x,
        y,
        this.isAxisZ ? this._initMovingBlockPosition : z
      ),
    });

    this._scene.add(this.movingBlock.mesh);
  }

  get isAxisX() {
    return this.axis === 'x';
  }

  get isAxisZ() {
    return this.axis === 'z';
  }

  _removeMovingBlock() {
    this._scene.remove(this.movingBlock?.mesh);
    this.movingBlock = null;
  }

  _createPlacedBlock() {
    this.placedBlock = new PlacedBlockModel(this);
    this._scene.add(this.placedBlock.mesh);
  }

  _createFallingBlock = (isLastFallingBlock) => {
    this.fallingBlock = new FallingBlockModel({ layer: this, isLastFallingBlock });
    this._scene.add(this.fallingBlock.mesh);
  };

  /**
   * Splits the moving block into placedBlock, which remains on the tower,
   * and fallingBlock, which falls down
   *
   * @param prevPlacedBlock The top block that lies on the tower
   *
   * @returns {boolean}
   *    false - The entire moving block fell down, the game is lost
   *    true - Part of the moving block remained on the tower, and part fell down, the game continues
   */
  cut(prevPlacedBlock) {
    this.overlap = this.isAxisX
      ? this.movingBlock.width - Math.abs(this.movingBlock.mesh.position.x - prevPlacedBlock.mesh.position.x)
      : this.movingBlock.depth - Math.abs(this.movingBlock.mesh.position.z - prevPlacedBlock.mesh.position.z);

    if (this.overlap <= 0) {
      this._createFallingBlock(true);
      this._removeMovingBlock();

      return false;
    }

    this.isCuttingBehind =
      this.movingBlock.mesh.position[this.axis] - prevPlacedBlock.mesh.position[this.axis] < 0;

    this._createPlacedBlock();
    this._createFallingBlock();
    this._removeMovingBlock();

    return true;
  }

  clear() {
    this._removeMovingBlock();

    this._scene.remove(
      this.placedBlock?.mesh,
      this.fallingBlock?.mesh
    );

    this.placedBlock = null;
    this.fallingBlock = null;
  }
}


/* ==========================
  Башня
  ========================== */

class Tower {
  layers = [];
  _direction = 1;
  baseBlock = new BlockModel({
    ...BASE_BLOCK_SIZE,
    color: COLOR.baseBlock,
  });

  constructor({ stage, onFinish }) {
    this._stage = stage;
    this._finish = onFinish;

    this._init();
  }

  get activeLayerIndex() {
    return this.layers.length - 1;
  }

  get activeLayer() {
    return this.layers[this.activeLayerIndex];
  }

  get prevLayer() {
    return this.layers[this.activeLayerIndex - 1];
  }

  get lastPlacedBlock() {
    return this.prevLayer?.placedBlock ?? this.baseBlock;
  }

  _init() {
    this._stage.scene.add(this.baseBlock.mesh);
    this._addFirstLayer();
  }

  _reverseDirection() {
    this._direction = this._direction * -1;
  }

  _addFirstLayer() {
    const layer = new LayerModel({
      scene: this._stage.scene,
      width: BASE_BLOCK_SIZE.width,
      depth: BASE_BLOCK_SIZE.depth,
      y: BASE_BLOCK_SIZE.height,
    });

    this.layers.push(layer);
  }

  _addLayer() {
    const layer = new LayerModel({
      scene: this._stage.scene,
      axis: this.activeLayer.isAxisX ? 'z' : 'x',
      width: this.activeLayer.placedBlock.width,
      depth: this.activeLayer.placedBlock.depth,
      x: this.activeLayer.placedBlock.mesh.position.x,
      y: (this.activeLayerIndex + 2) * BASE_BLOCK_SIZE.height,
      z: this.activeLayer.placedBlock.mesh.position.z,
    });

    this.layers.push(layer);
    this._stage.camera.syncPosition(
      this.lastPlacedBlock.mesh.position
    );
  }

  tick(delta) {
		this.layers.forEach((layer) => layer.fallingBlock?.tick(delta));

    if (!this.activeLayer.movingBlock) {
      return;
    }

    const activeAxisPosition = this.activeLayer.movingBlock.mesh.position[this.activeLayer.axis];

		if (activeAxisPosition > MOVING_RANGE) {
      this.activeLayer.movingBlock.mesh.position[this.activeLayer.axis] = MOVING_RANGE;
      this._reverseDirection();
    }

    if (activeAxisPosition < -MOVING_RANGE) {
      this.activeLayer.movingBlock.mesh.position[this.activeLayer.axis] = -MOVING_RANGE;
      this._reverseDirection();
    }

    this.activeLayer.movingBlock.mesh.position[this.activeLayer.axis] += delta * SPEED_FACTOR * this._direction;
  }

  place() {
    const result = this.activeLayer.cut(this.lastPlacedBlock);

    if (result) {
      this._addLayer();
      return;
    }

    this._finish();
  }

  reset() {
    this._direction = 1;

    this.layers.forEach((layer) => layer.clear());

    this.layers = [];
    this._addFirstLayer();
  }
}


/* ==========================
  Камера
  ========================== */

class CameraModel {
  _viewDistance = 20;
  _near = 0.1;
  _far = 100;
  _initialPosition = new THREE.Vector3(30, 30, 30);

  constructor(stage) {
    this._stage = stage;

    this.instance = new THREE.OrthographicCamera(
      this._viewDistance * -1 * this._stage.aspectRatio,
      this._viewDistance * this._stage.aspectRatio,
      this._viewDistance,
      this._viewDistance * -1,
      this._near,
      this._far,
    );

    this._init();
  }

  _init() {
    this.resetPosition();
    this.instance.lookAt(0, 0, 0);

    this._stage.scene.add(this.instance);
  }

  update() {
    this.instance.left = this._viewDistance * -1 * this._stage.aspectRatio;
    this.instance.right = this._viewDistance * this._stage.aspectRatio;

    this.instance.updateProjectionMatrix()
  }

  syncPosition({ x, y, z }) {
    const maxY = 100;
    gsap.to(this.instance.position, {
      ease: 'expo.out',
      duration: 1,
      x: this._initialPosition.x + x,
      y: Math.min(this._initialPosition.y + y, maxY),
      z: this._initialPosition.z + z,
    });
  }

  resetPosition() {
    this.instance.position.set(...Object.values(this._initialPosition));
  }
}

class Stage {
  sizes = {
    width: window.innerWidth,
    height: window.innerHeight
  };

  scene = new THREE.Scene();
  ambientLight = new THREE.AmbientLight('white', 2);
  directionalLight = new THREE.DirectionalLight('white', 2);

  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas });
    this.camera = new CameraModel(this);
    this._onResizeBound = this._onResize.bind(this);

    this._init();
  }

  get aspectRatio() {
    return this.sizes.width / this.sizes.height;
  }

  _init() {
    this.scene.background = new THREE.Color(COLOR.background);
    this.directionalLight.position.set(10, 18, 6);
    this.scene.add(this.directionalLight, this.ambientLight);
    this._updateRenderer();
    window.addEventListener('resize', this._onResizeBound);
  }

  _onResize() {
    if (resizeTimeout) cancelAnimationFrame(resizeTimeout);
    resizeTimeout = requestAnimationFrame(() => {
      this.sizes.width = window.innerWidth;
      this.sizes.height = window.innerHeight;

      this.camera.update();
      this._updateRenderer();
    });
  }

  _updateRenderer() {
    this.renderer.setSize(this.sizes.width, this.sizes.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  }

  renderFrame() {
    this.renderer.render(this.scene, this.camera.instance);
  }

  destroy() {
    window.removeEventListener('resize', this._onResizeBound);
  }
}

class Game {
  canvas = document.querySelector('#canvas');
  board = document.body.querySelector('.board');
  restartButton = document.body.querySelector('#button');
  scoreElement = document.getElementById('score');
  highscoreElement = document.getElementById('highscore');

  clock = new THREE.Clock();

  _prevTimer = 0;
  _isGameOver = false;
  _score = 0;
  _highscore = 0;
  _isNewRecord = false;

  constructor() {
    this.stage = new Stage(this.canvas);

    this.tower = new Tower({
      stage: this.stage,
      onFinish: () => this.end(),
    });

    this._init();
  }

  _init() {
    this._score = 0;
    this._isNewRecord = false;
    this._loadHighscore();
    this.updateScore();
    this._animate();

    this.canvas.addEventListener('click', () => {
      if (this._isGameOver) return;
      const prevLayers = this.tower.layers.length;
      this.tower.place();
      if (this.tower.layers.length > prevLayers) {
        this._score++;
        if (this._score > this._highscore) {
          this._highscore = this._score;
          this._isNewRecord = true;
          this._saveHighscore();
        }
        this.updateScore();
      }
    });

    this.restartButton.addEventListener('click', () => this.restart());
  }

  _animate = () => {
    if (!this._isGameOver) {
      const delta = this.clock.getDelta();
      this.tower.tick(delta);
      this.stage.renderFrame();
    }
    requestAnimationFrame(this._animate);
  }

  updateScore() {
    if (this.scoreElement) this.scoreElement.textContent = `Result: ${this._score}`;
    if (this.highscoreElement) this.highscoreElement.textContent = `Highscore: ${this._highscore}`;
  }

  _loadHighscore() {
    const saved = localStorage.getItem('tower_highscore');
    this._highscore = saved ? parseInt(saved, 10) : 0;
  }

  _saveHighscore() {
    localStorage.setItem('tower_highscore', this._highscore);
  }

  end() {
    this._isGameOver = true;
    this.board.style.display = 'flex';
    let message = `Game Over<br>Your Result: ${this._score}`;
    if (this._isNewRecord) {
      message += `<br><span style="color:green;">New Record!</span>`;
      gsap.to(this.canvas, { backgroundColor: "#0092E1", duration: .5, yoyo: true, repeat: 1 });
    } else {
      gsap.to(this.canvas, { opacity: .3, duration: .5, yoyo: true, repeat: 1 });
    }
    this.board.innerHTML = `<div style="font-size:2em;">${message}</div><button id="button">Restart</button>`;
    setTimeout(() => {
      document.getElementById('button').onclick = () => this.restart();
    }, 100);
  }

  restart() {
    this.stage.camera.resetPosition();
    this.tower.reset();
    this._isGameOver = false;
    this._score = 0;
    this._isNewRecord = false;
    this.updateScore();
    this.board.style.display = 'none';
    gsap.to(this.canvas, { opacity: 1, duration: 0.3 });
  }
}

new Game();
