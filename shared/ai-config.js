
import { Type } from "@google/genai";

export const MODEL_IDS = {
  FLASH: 'gemini-3-flash-preview',
  PRO: 'gemini-3-pro-preview'
};

export const PROMPTS = {
  BASIC: `分析这张数学试卷图片，试卷页面是三栏布局，它包含若干道题目，请精准识别每个题目的边界，以便后续裁剪。

一、识别规则：
0. 框图必须精准而紧凑，刚好能够包含题号和题目，但题干使用的是悬挂缩进，注意不要把题号排除了。
1. **一个题号 = 一个独立 ID**：页面上每一个主题号（如 "13.", "14.", "15."）。
   - 题号通常是阿拉伯数字后跟一个小圆点或括号。
   - 严禁把两位数的题号只识别为个位数，如把13识别为3。
   - 有时候填空题的题本是以下划线结尾，务必保留下划线区域，右侧留出足够空白，避免下划线被裁剪。
2. **排除标题区域**：
   - **严禁**将“一、选择题”、“二、填空题”等板块大标题或“本大题共XX分”的说明文字包含在题目的框内。
   - 题目的边界框应当**紧贴**该题的题号开始。
3. **包含所有关联内容**：
   - 题目内部的子问题（如 (1), (2)）、插图（几何图形、函数图象）以及选项（A,B,C,D）必须完整包含在框内。
4. **跨栏处理**：
   - 如果一道题占据了左右两栏（通常是左栏底部到右栏顶部），请把右栏顶部标记为ID="continuation"。
5. **跨页标记**：
   - 如果页面最顶端的内容明显是上一页某道题的未完部分（没有新题号），请将其标记为 ID="continuation"。
6. **宽度固定**：
   - 每道题的宽度是固定的，不要因为题干长短不同而改变宽度。

二、特别要求

三、输出结构（单框）：
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
