
const {ccclass, property} = cc._decorator;

// 1. 优化算法，减少计算量，每次循环只计算上次新产生的格子即可。
// 2. 显示不能走的地图边缘。
// 3. 增加支持优势地形和劣势地形。

@ccclass
export default class FireEmblem extends cc.Component {

    @property({
        type: cc.Node
    })
    bg: cc.Node;

    /** 地图数据 */
    private _mapData: Map<string, number>;
    /** 地图配置数据 */
    private _mapCfg: Map<number, number>;


    // 临时数据 用于存储上次地图绘制的数据
    tempList: MapPos[] = [];

    start () {
        cc.loader.loadRes("prefabs/tiled", cc.Prefab, (err, prefab) => {
            // 构建地图数据
            // 1.地形配置
            let mc = new Map<number, number>();
            mc.set(1, 1);   // 平原
            mc.set(2, 2);   // 沙漠
            mc.set(3, 3);   // 山地
            // 2.地图数据
            let md = new Map<string, number>();
            for (let i = 0; i < 100; i++) {
                for (let j = 0; j < 100; j++) {
                    let v = Math.ceil(Math.random() * 3);
                    md.set(i + "_" + j, v);
                    this.initTestMap(prefab, i, j, v);
                }
            }
            // 3.初始化地图配置
            this.initMapConfig(md, mc);
        });
    }

    // 初始化测试地图
    initTestMap(prefab: cc.Prefab, x: number, y: number, type: number) {
        let tiled = cc.instantiate(prefab);
        tiled.x = x * 48 - 2400;
        tiled.y = y * 48 - 2400;
        this.bg.addChild(tiled);
        tiled.color = this.getColor(type);
        tiled.name = x + "_" + y;
        tiled.on(cc.Node.EventType.TOUCH_END, () => {
            this.resetColor();
            // 4.获取可行动数据
            let result = this.getCanMoveData(cc.v2(x, y), 4, null, true);
            // 5.打印结果
            console.dir(result);
            this.setColor(result);
        }, this);
    }

    // 设置地图颜色
    setColor(list: MapPos[]) {
        this.tempList = list;
        for (let t of list) {
            let tiled = this.bg.getChildByName(t.x + "_" + t.y);
            if (tiled) {
                if (t.status > 0) {
                    tiled.color = cc.Color.GREEN;
                } else {
                    tiled.color = cc.Color.RED;
                }
            }
        }
    }

    // 重置地图颜色
    resetColor() {
        for (let t of this.tempList) {
            let key = t.x + "_" + t.y;
            let tiled = this.bg.getChildByName(key);
            if (tiled) {
                tiled.color = this.getColor(this._mapData.get(key));
            }
        }
        this.tempList = [];
    }

    // 根据地形获取颜色
    getColor(type: number): cc.Color {
        if (type == 1) {
            return new cc.Color(202, 245, 196);
        } else if (type == 2) {
            return new cc.Color(245, 241, 225);
        } else if (type == 3) {
            return new cc.Color(240, 225, 247);
        } else {
            return new cc.Color(202, 245, 196);
        }
    }


    // TODO============================ 以下内容后续封装 ============================

    /** 不能移动的边缘地格 */
    private _canntList: MapPos[] = [];
    /** 当前移动对象的配置，用于配置目标擅长或者劣势地形，默认为空 */
    private _targetCfg: Map<number, number>;
    /** 最低移动步数，当前移动对象至少移动的步数，默认为1步 */
    private _minStep: number = 1;

    /**
     * 初始化地图配置，注意地形类型不要设定为0，推荐为大于0的整数，算法中0作为默认值存在。
     * @param {Map<string, number>} mapData 地图数据，map的key是地图坐标x + “_” + y, value是地面类型；
     * @param {Map<number, number>} mapCfg 地形配置，对应类型消耗的行动力；默认为消耗1行动力地形；
     */
    initMapConfig(mapData: Map<string, number>, mapCfg?: Map<number, number>, minStep?: number) {
        this._mapData = mapData;
        if (mapCfg) {
            this._mapCfg = mapCfg;
        } else {
            this._mapCfg = new Map<number, number>();
            this._mapCfg.set(1, 1);
        }
        if (minStep) {
            this._minStep = minStep;
        }
    }

    /**
     * 获取移动数据
     * @param {cc.Vec2} pos 移动原点 
     * @param {number} limit 行动力
     * @param {Map<number, number>} targetCfg 当前移动对象的配置，用于配置目标擅长或者劣势地形，默认为空(可选)
     * @param {boolean} isShowEdge 是否返回不能移动的边缘数据，默认为不返回(可选)
     */
    getCanMoveData(pos: cc.Vec2, limit: number, targetCfg?: Map<number, number>,
                    isShowEdge: boolean = false): MapPos[] {
        if (targetCfg) {
            this._targetCfg = targetCfg;
        } else {
            this._targetCfg = null;
        }
        // 存储可移动坐标的结果数组
        let resultPos: MapPos[] = [];
        // 将原点存入结果
        let center = new MapPos(pos.x, pos.y, 0, MapPosStatus.CAN_MOVE);
        resultPos.push(center);
        let stepCount = 0;
        let start = 0;
        // 逐步判断
        while (stepCount < limit) {
            start = this.scanMap(resultPos, limit, start);
            stepCount++;
        }
        // 是否显示不可移动的边缘
        if (isShowEdge) {
            let r = resultPos.concat(this._canntList);
            this._canntList = [];
            return r;
        } else {
            return resultPos;
        }
    }

    /**
     * 开始扫描地图
     * @param {MapPos[]} resultPos 结果列表
     * @param {number} limitStep 行动力
     * @param {number} start 当前检索的起始位置，优化算法使用
     */
    scanMap(resultPos: MapPos[], limitStep: number, start: number) {
        let len = resultPos.length;
        for (; start < resultPos.length; start++) {
            let pos = resultPos[start];
            // 检查四个方向
            this.checkMapPos(new MapPos(pos.x, pos.y - 1, pos.limit), resultPos, limitStep);   // 上
            this.checkMapPos(new MapPos(pos.x, pos.y + 1, pos.limit), resultPos, limitStep);   // 下
            this.checkMapPos(new MapPos(pos.x - 1, pos.y, pos.limit), resultPos, limitStep);   // 左
            this.checkMapPos(new MapPos(pos.x + 1, pos.y, pos.limit), resultPos, limitStep);   // 右
        }
        return len;
    }

    /**
     * 检查指定坐标点能否移动
     * @param {MapPos} pos 目标坐标点
     * @param {MapPos[]} resultPos 结果列表
     * @param {number} limit 行动力
     */
    checkMapPos(pos: MapPos, resultPos: MapPos[], limit: number) {
        // 判断该点是否有效、是否以加入可行动队列、行动力是否足够
        if (pos.x > 0 && pos.y > 0) {
            let targetPos = this._mapData.get(pos.x + "_" + pos.y);
            if (targetPos) {
                let newPos = resultPos.find((p: MapPos) => {
                    return (p.x === pos.x && p.y === pos.y);
                });
                if (!newPos) {
                    let value = pos.limit + this.getStepByType(targetPos) 
                                + this.getTargetStepByType(targetPos);
                    if (value <= 0) {
                        // 如果计算的最终步数小于等于0，那么移动最小步数。
                        value = this._minStep;
                    }
                    if (value <= limit) {
                        pos.limit = value;
                        pos.status = MapPosStatus.CAN_MOVE;
                        resultPos.push(pos);
                    } else {
                        pos.status = MapPosStatus.CAN_NOT_MOVE;
                        this._canntList.push(pos);
                    }
                }
            } else {
                console.log("位置:", pos.x, pos.y, "值为:", targetPos, "不能移动");
            }
        }
    }

    /**
     * 根据指定地形获取该地形消耗的行动力
     * @param type 地形类型
     */
    getStepByType(type: number): number {
        let step = this._mapCfg.get(type);
        if (step > 0) {
            return step;
        }
        console.warn("该类型地形不存在:", type);
        return 999999;
    }

    /**
     * 根据指定地形获取当前对象的优劣行动力增量
     * @param type 地形
     */
    getTargetStepByType(type: number): number {
        if (this._targetCfg) {
            let step = this._targetCfg.get(type);
            if (step >= 0) {
                return step;
            }
        }
        return 0;
    }
    
}

/** 地图格子状态枚举 */
export enum MapPosStatus {
    CAN_NOT_MOVE = 0,   // 不能移动   
    CAN_MOVE = 1        // 可移动
}

/** 地图坐标对象 */
export class MapPos {
    public x: number;
    public y: number;
    public status: MapPosStatus = MapPosStatus.CAN_NOT_MOVE;  // 0: 不能移动， 1: 可移动
    public limit: number = 0;   // 当前点的剩余行动力
    public constructor(x: number, y: number, limit?: number, s?: MapPosStatus) {
        this.x = x;
        this.y = y;
        if (s) this.status = s;
        if (limit) this.limit = limit;
    }
    /** 转成cc.Vec2 */
    public toVec2(): cc.Vec2 {
        return cc.v2(this.x, this.y);
    }
}

