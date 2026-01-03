
import { Type } from "@google/genai";

export const MODEL_IDS = {
  FLASH: 'gemini-3-flash-preview',
  PRO: 'gemini-3-pro-preview'
};

export const PROMPTS = {
  BASIC: `分析这张高考数学试卷页面并提取题目。

严格目标：
1. **精确性**：边界划分要紧凑, 绝对要避免截到其他题目的文本。
2. **完整性（关键）**：务必确保题号完整包含在框内。特别是两位数题号，边界框的左侧（xmin）必须包含第一个数字，不要切掉。
3. **跨页处理（非常重要）**：如果你在页面的**最顶部**发现了一些看起来像上一题延续的内容（例如：仅有选项 C/D、没有题干的图表、断句的文本），请将其提取出来，并将 ID 标记为 "continuation"。

输出规则：
- 返回一个 JSON 数组。
- 'id': 题号（例如 "11"），如果是上一页的残留内容，使用 "continuation"。
- 'boxes_2d': 一个数组 [ymin, xmin, ymax, xmax]（0-1000 归一化坐标）。

框选逻辑：
- **单栏**：返回一个包含所有内容的框。
- **跨栏**：如果一道题跨栏，返回两个框：[框 1 (第一栏末尾)], [框 2 (第二栏开头)]。
- **安全检查**：如果不确定图表属于 Q11 还是 Q12，请检查空间邻近度。图表通常出现在文字的*下方*或*旁边*，很少出现在题号上方。`
};

export const SCHEMAS = {
  BASIC: {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.STRING },
      boxes_2d: {
        type: Type.ARRAY,
        items: {
          type: Type.ARRAY,
          items: { type: Type.NUMBER }
        },
        description: "Array of [ymin, xmin, ymax, xmax] normalized 0-1000"
      }
    },
    required: ["id", "boxes_2d"]
  }
};