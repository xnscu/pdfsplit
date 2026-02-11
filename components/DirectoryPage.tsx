import React, { useState, useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { DirectoryNode, directoryTree, getAllNodes } from "../services/directoryService";
import { searchQuestions } from "../services/syncService";
import { QuestionImage } from "../types";
import { QuestionDisplayCard } from "./QuestionDisplayCard";

export const DirectoryPage: React.FC = () => {
  const [nodes] = useState<DirectoryNode[]>(directoryTree);
  const [questions, setQuestions] = useState<QuestionImage[]>([]);
  const [totalQuestions, setTotalQuestions] = useState(0);
  const [selectedNode, setSelectedNode] = useState<DirectoryNode | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const QUESTIONS_PER_PAGE = 20;

  const [searchParams, setSearchParams] = useSearchParams();
  const allNodes = useMemo(() => getAllNodes(nodes), [nodes]);

  // Sync state from URL
  useEffect(() => {
    const nodeId = searchParams.get("nodeId");
    const pageParam = searchParams.get("page");
    const newPage = pageParam ? parseInt(pageParam, 10) : 1;

    if (nodeId) {
      const node = allNodes.find((n) => n.id === nodeId);
      if (node) {
        if (selectedNode?.id !== node.id) {
          setSelectedNode(node);
        }
      } else {
        // Node ID in URL invalid or not found
        setSelectedNode(null);
      }
    } else {
      setSelectedNode(null);
    }

    if (!isNaN(newPage) && newPage > 0) {
      if (currentPage !== newPage) {
        setCurrentPage(newPage);
      }
    } else {
      if (currentPage !== 1) {
        setCurrentPage(1);
      }
    }
  }, [searchParams, allNodes]);

  // Helper to extract levels for API query
  const getLevelsFromNode = (node: DirectoryNode) => {
    const levels: { level0?: string; level1?: string; level2?: string; level3?: string } = {};
    let current: DirectoryNode | undefined = node;
    while (current) {
      if (current.level === 0) levels.level0 = current.name;
      if (current.level === 1) levels.level1 = current.name;
      if (current.level === 2) levels.level2 = current.name;
      if (current.level === 3) levels.level3 = current.name;
      current = current.parent;
    }
    return levels;
  };

  // Fetch questions when node or page changes
  useEffect(() => {
    const fetchQuestions = async () => {
      if (!selectedNode) {
        setQuestions([]);
        setTotalQuestions(0);
        return;
      }

      setIsLoading(true);
      try {
        const levels = getLevelsFromNode(selectedNode);
        const result = await searchQuestions({
          ...levels,
          limit: QUESTIONS_PER_PAGE,
          offset: (currentPage - 1) * QUESTIONS_PER_PAGE,
        });
        setQuestions(result.data);
        setTotalQuestions(result.total);
      } catch (error) {
        console.error("Failed to load questions:", error);
        // Optionally show toast or error state
      } finally {
        setIsLoading(false);
      }
    };

    fetchQuestions();
  }, [selectedNode, currentPage]);

  const handleNodeClick = (node: DirectoryNode) => {
    setSearchParams({ nodeId: node.id, page: "1" });
  };

  const renderNode = (node: DirectoryNode) => {
    const isSelected = selectedNode?.id === node.id;
    // Helper to check if node is in current selection path (optional visual cue)
    // const isActive = selectedNode && getLevelsFromNode(selectedNode)[`level${node.level}` as keyof ...] === node.name;

    return (
      <div key={node.id} className="ml-4">
        <div
          className={`cursor-pointer py-1 px-2 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors ${
            isSelected ? "bg-blue-50 text-blue-600 font-semibold" : "text-slate-700"
          }`}
          onClick={(e) => {
            e.stopPropagation();
            handleNodeClick(node);
          }}
        >
          {node.name}
        </div>
        {node.children.length > 0 && (
          <div className="border-l border-slate-200 ml-2">{node.children.map(renderNode)}</div>
        )}
      </div>
    );
  };

  const totalPages = Math.ceil(totalQuestions / QUESTIONS_PER_PAGE);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shadow-sm z-10">
        <div className="flex items-center gap-4">
          <Link to="/" className="text-slate-500 hover:text-slate-700 transition-colors">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </Link>
          <h1 className="text-xl font-bold text-slate-800">Knowledge Directory</h1>
        </div>
        <div className="text-sm text-slate-500">
          {selectedNode ? `Showing ${questions.length} of ${totalQuestions} results` : "Select a topic"}
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-1/4 min-w-[300px] max-w-md bg-white border-r border-slate-200 overflow-y-auto p-4 custom-scrollbar">
          <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Table of Contents</h2>
          <div className="space-y-1 text-sm">{nodes.map(renderNode)}</div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto p-6 scroll-smooth">
          {!selectedNode ? (
            <div className="flex items-center justify-center h-full text-slate-400 flex-col gap-4">
              <svg className="w-16 h-16 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                />
              </svg>
              <p>Select a chapter or section from the directory to view questions.</p>
            </div>
          ) : (
            <div className="max-w-6xl mx-auto">
              <div className="mb-6 flex items-center justify-between">
                <h2 className="text-2xl font-bold text-slate-800">{selectedNode.name}</h2>
                <div className="bg-slate-100 text-slate-600 px-3 py-1 rounded-full text-sm font-medium">
                  {totalQuestions} Matches
                </div>
              </div>

              {isLoading ? (
                <div className="flex items-center justify-center h-64 text-slate-400">Loading data from D1...</div>
              ) : questions.length === 0 ? (
                <div className="bg-white rounded-2xl p-12 text-center border border-dashed border-slate-300 text-slate-500">
                  No questions found for this section.
                </div>
              ) : (
                <>
                  <div className="flex flex-col items-start w-full">
                    {questions.map((q) => (
                      <QuestionDisplayCard
                        key={`${q.fileName}-${q.id}`}
                        question={q}
                        enableAnchors={false}
                        showExplanations={true}
                        showExamName={true}
                        onQuestionClick={() => {
                          // Navigate to inspect page on click
                          window.location.hash = `/inspect/${q.exam_id || ""}#question-${q.id}`;
                        }}
                      />
                    ))}
                  </div>

                  {/* Pagination */}
                  {totalPages > 1 && (
                    <div className="flex justify-center mt-12 mb-8 gap-2">
                      <button
                        onClick={() => {
                          if (selectedNode) {
                            setSearchParams({ nodeId: selectedNode.id, page: String(Math.max(1, currentPage - 1)) });
                          }
                        }}
                        disabled={currentPage === 1}
                        className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                      </button>
                      <span className="flex items-center px-4 font-medium text-slate-600">
                        Page {currentPage} of {totalPages}
                      </span>
                      <button
                        onClick={() => {
                          if (selectedNode) {
                            setSearchParams({
                              nodeId: selectedNode.id,
                              page: String(Math.min(totalPages, currentPage + 1)),
                            });
                          }
                        }}
                        disabled={currentPage === totalPages}
                        className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
};
