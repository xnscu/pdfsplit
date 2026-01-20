
import { Type } from "@google/genai";

export const MODEL_IDS = {
  FLASH: 'gemini-3-flash-preview',
  PRO: 'gemini-3-pro-preview'
};

export const PROMPTS = {
  BASIC: `分析这张数学试卷图片，试卷页面是三栏布局，它包含若干道题目，请精准识别每个题目的边界，以便后续裁剪。

一、识别规则：
0. 框图必须精准而紧凑，刚好能够包含题号和题目。注意题干使用的是悬挂缩进，不要把题号排除了。
1. 题号规则
   - 题号由阿拉伯数字后接一个英文句点构成，如 "13.", "14.", "15."。
   - 题号就是你输出结构的id，它只能是数字。
2. **排除标题区域**：
   - **严禁**将“一、选择题”、“二、填空题”等板块大标题或“本大题共XX分”的说明文字包含在题目的框内。
   - 题目的边界框应当**紧贴**该题的题号开始。
3. **框图必须包含所有关联内容**：
   - 选择题的选项（A,B,C,D）
   - 插图（几何图形、函数图象）
   - 子题：如 (1)、 (2)或者【甲】、【乙】这种字符开头的题。
4. **跨栏、跨页题目的判断**：
   - 如果一栏或一页的区域**没有**以题号开头（如 "13.", "14.", "15."），请把它标记为ID="continuation"。
5. **宽度固定**：
   - 所有题的boxes_2d的宽度应该相同，以最长的那个宽度为准。

二、输出结构（单框）：
[
  {
    "id": "题号字符串",
    "boxes_2d": [ymin, xmin, ymax, xmax]
  }
]

结构（多框）：
[
  {
    "id": "题号字符串",
    "boxes_2d": [ymin, xmin, ymax, xmax]
  },
  {
    "id": "continuation",
    "boxes_2d": [ymin, xmin, ymax, xmax]
  }
]
`
};

export const SCHEMAS = {
  BASIC: {
    type: Type.OBJECT,
    properties: {
      id: {
        type: Type.STRING,
        description: "题号字符串，如 '1' 或 '13'。如果是跨栏或跨页内容则设为 'continuation'。"
      },
      boxes_2d: {
        type: Type.ARRAY,
        items: {
          type: Type.NUMBER,
        },
        description: "该题目的边界框列表 [ymin, xmin, ymax, xmax] (0-1000)。"
      }
    },
    required: ["id", "boxes_2d"]
  }
};
