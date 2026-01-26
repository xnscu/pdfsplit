import { Type } from "@google/genai";
import { analysisPrompt } from "./analysis-prompt.js";

export const MODEL_IDS = {
  FLASH: "gemini-3-flash-preview",
  PRO: "gemini-3-pro-preview",
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
`,
  ANALYSIS: analysisPrompt,
};

export const SCHEMAS = {
  BASIC: {
    type: Type.OBJECT,
    properties: {
      id: {
        type: Type.STRING,
        description:
          "题号字符串，如 '1' 或 '13'。如果是跨栏或跨页内容则设为 'continuation'。",
      },
      boxes_2d: {
        type: Type.ARRAY,
        items: {
          type: Type.NUMBER,
        },
        description: "该题目的边界框列表 [ymin, xmin, ymax, xmax] (0-1000)。",
      },
    },
    required: ["id", "boxes_2d"],
  },
  ANALYSIS: {
    type: Type.OBJECT,
    properties: {
      picture_ok: { type: Type.BOOLEAN, description: "图片是否完整" },
      difficulty: { type: Type.INTEGER, description: "1-5, 5为最难" },
      question_type: { type: Type.STRING, description: "选择/填空/解答" },
      tags: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            level0: {
              type: Type.STRING,
              description: "必填，例如: '第十一章 立体几何初步'",
            },
            level1: {
              type: Type.STRING,
              description: "必填，例如: '11.1 空间几何体'",
            },
            level2: {
              type: Type.STRING,
              description: "可空，例如: '11.1.1 空间几何体与斜二测画法'",
            },
            level3: {
              type: Type.STRING,
              description: "可空，例如：1. 空间几何体",
            },
          },
          required: ["level0", "level1"],
        },
      },
      question_md: {
        type: Type.STRING,
        description:
          "题目文本，必须使用Markdown格式。数学公式必须使用LaTeX格式并用 $ 或 $$ 包裹。",
      },
      solution_md: {
        type: Type.STRING,
        description:
          "题目答案。1. 选择题给出ABCD字母本身即可，解析写在analysis_md。2.填空题给出答案本身即可，解析写在analysis_md。3.解答题必须给出完整的、分步的、包含评分标准的解答过程（写出'解：'）。所有数学公式必须使用LaTeX格式并用 $ 或 $$ 包裹。",
      },
      analysis_md: {
        type: Type.STRING,
        description:
          "解题思路分析。所有数学公式必须使用LaTeX格式并用 $ 或 $$ 包裹。",
      },
      breakthrough_md: {
        type: Type.STRING,
        description:
          "突破口（选填）。此字段主要针对难题，简单题目可以不写。所有数学公式必须使用LaTeX格式并用 $ 或 $$ 包裹。",
      },
    },
    required: [
      "picture_ok",
    ],
  },
};
