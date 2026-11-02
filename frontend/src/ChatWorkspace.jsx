import React, { useEffect, useRef, useState } from 'react';
import MarkdownRenderer from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { createLowlight } from 'lowlight';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import css from 'highlight.js/lib/languages/css';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import { ArrowUp, BookOpenCheck, Check, ChevronDown, Copy, Eye, FileText, LogOut, Menu, MessageSquare, MessageSquarePlus, Pencil, Search, Sparkles, Trash2, Upload, X } from 'lucide-react';
import './chat.css';
import 'highlight.js/styles/github-dark.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
const lowlight = createLowlight({ bash, c, cpp, css, go, java, javascript, json, python, rust, sql, typescript, xml, yaml });

function highlightMarkdownCode() {
  return function transform(tree) {
    function visit(node) {
      if (node.type === 'element' && node.tagName === 'code') {
        const classes = Array.isArray(node.properties?.className) ? node.properties.className : [];
        const languageClass = classes.find((value) => typeof value === 'string' && value.startsWith('language-'));
        const language = languageClass?.slice('language-'.length);
        if (language && lowlight.registered(language)) {
          const highlighted = lowlight.highlight(language, readHastText(node.children || []));
          node.children = highlighted.children;
          node.properties.className = [...classes, 'hljs'];
        }
      }
      for (const child of node.children || []) visit(child);
    }
    visit(tree);
  };
}

function readHastText(nodes) {
  if (Array.isArray(nodes)) return nodes.map(readHastText).join('');
  if (!nodes || typeof nodes !== 'object') return '';
  if (nodes.type === 'text') return nodes.value || '';
  return readHastText(nodes.children || []);
}

function CodeBlock({ children }) {
  const [copied, setCopied] = useState(false);
  const codeElement = React.Children.toArray(children).find((child) => React.isValidElement(child));
  const code = readNodeText(codeElement?.props?.children ?? children);
  const language = codeElement?.props?.className?.match(/language-([^\s]+)/)?.[1] || 'Code';

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(String(code));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return <div className="code-block"><div className="code-toolbar"><span>{language}</span><button className="copy-code" onClick={copyCode} aria-label="Copy code">{copied ? <Check size={13}/> : <Copy size={13}/>} {copied ? 'Copied' : 'Copy code'}</button></div><pre>{children}</pre></div>;
}

function readNodeText(node) {
  if (Array.isArray(node)) return node.map(readNodeText).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (React.isValidElement(node)) return readNodeText(node.props.children);
  return '';
}

function ReactMarkdown(props) {
  const [copied, setCopied] = useState(false);

  async function copyResponse() {
    try {
      await navigator.clipboard.writeText(String(props.children ?? ''));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return <div className="markdown-render"><MarkdownRenderer {...props} rehypePlugins={[...(props.rehypePlugins || []), highlightMarkdownCode]} components={{ ...props.components, pre: CodeBlock }} /><div className="markdown-tools"><button className="copy-response" onClick={copyResponse} aria-label="Copy response">{copied ? <Check size={13}/> : <Copy size={13}/>} {copied ? 'Copied' : 'Copy response'}</button></div></div>;
}

export default function ChatWorkspace({ user, onLogout }) {
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [sending, setSending] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(null);
  const [dialogValue, setDialogValue] = useState('');
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [documents, setDocuments] = useState([]);
  const [loadingDocuments, setLoadingDocuments] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [documentNotice, setDocumentNotice] = useState('');
  const [documentViewer, setDocumentViewer] = useState(null);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState([]);
  const [studyMenuOpen, setStudyMenuOpen] = useState(false);
  const documentInputRef = useRef(null);
  const textareaRef = useRef(null);
  const scrollRef = useRef(null);
  const name = user.name.split(/\s+/)[0];
  const initials = user.name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();

  async function api(path, options = {}) {
    const token = localStorage.getItem('forma_token');
    const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        ...(options.body && !isFormData ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
    if (response.status === 401) { onLogout(); throw new Error('Your session expired. Please sign in again.'); }
    if (response.status === 204) return null;
    const data = await response.json();
    if (!response.ok) {
      const requestError = new Error(data.message || 'The request could not be completed.');
      requestError.data = data;
      throw requestError;
    }
    return data;
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [data, documentData] = await Promise.all([api('/conversations'), api('/documents')]);
        if (cancelled) return;
        setConversations(data.conversations);
        setDocuments(documentData.documents);
        const savedSelection = localStorage.getItem(`forma_selected_documents_${user.id}`);
        const readyIds = documentData.documents.filter((item) => item.status === 'ready' && !item.needsReindex).map((item) => item.id);
        const selection = savedSelection === null ? readyIds : JSON.parse(savedSelection).filter((id) => readyIds.includes(id));
        setSelectedDocumentIds(selection);
        localStorage.setItem(`forma_selected_documents_${user.id}`, JSON.stringify(selection));
        const rememberedId = localStorage.getItem(`forma_last_conversation_${user.id}`);
        const first = data.conversations.find((item) => item.id === rememberedId) || data.conversations[0];
        if (first) await selectConversation(first.id);
      } catch (loadError) {
        if (!cancelled) setError(loadError.message);
      } finally { if (!cancelled) { setLoadingHistory(false); setLoadingDocuments(false); } }
    })();
    return () => { cancelled = true; };
    // Load conversation history once after authentication.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  useEffect(() => {
    function handleShortcut(event) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        newConversation();
      }
    }
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  async function selectConversation(id) {
    setActiveId(id);
    localStorage.setItem(`forma_last_conversation_${user.id}`, id);
    setMessages([]);
    setLoadingConversation(true);
    setError('');
    try {
      const data = await api(`/conversations/${id}`);
      setMessages(data.conversation.messages || []);
    } catch (loadError) { setError(loadError.message); }
    finally { setLoadingConversation(false); setSidebarOpen(false); }
  }

  async function newConversation() {
    setError('');
    try {
      const data = await api('/conversations', { method: 'POST', body: '{}' });
      const conversation = data.conversation;
      setConversations((items) => [
        { id: conversation._id, title: conversation.title, updatedAt: conversation.updatedAt, messageCount: 0, preview: '' },
        ...items,
      ]);
      setActiveId(conversation._id);
      setMessages([]);
      localStorage.setItem(`forma_last_conversation_${user.id}`, conversation._id);
      setSidebarOpen(false);
      textareaRef.current?.focus();
    } catch (createError) { setError(createError.message); }
  }

  async function uploadDocument(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setUploading(true); setError(''); setDocumentNotice('');
    const formData = new FormData();
    formData.append('file', file);
    try {
      const data = await api('/documents', { method: 'POST', body: formData });
      setDocuments((items) => [data.document, ...items.filter((item) => item.id !== data.document.id)]);
      if (data.document.status === 'ready' && !data.document.needsReindex) {
        setSelectedDocumentIds((items) => {
          const next = items.includes(data.document.id) ? items : [...items, data.document.id];
          localStorage.setItem(`forma_selected_documents_${user.id}`, JSON.stringify(next));
          return next;
        });
      }
      setDocumentNotice(data.alreadyProcessed ? `${data.document.name} is already indexed.` : `${data.document.name} is ready to use in chat.`);
    } catch (uploadError) {
      setError(uploadError.message);
      try { const refreshed = await api('/documents'); setDocuments(refreshed.documents); } catch { /* Keep the upload error visible. */ }
    } finally { setUploading(false); }
  }

  async function openDocument(document) {
    setError(''); setDocumentViewer({ document, loading: true, chunks: [] });
    try {
      const data = await api(`/documents/${document.id}`);
      setDocumentViewer({ document: data.document, loading: false, chunks: data.chunks });
    } catch (viewError) { setDocumentViewer(null); setError(viewError.message); }
  }

  function toggleDocumentSelection(document) {
    if (document.status !== 'ready' || document.needsReindex) return;
    setSelectedDocumentIds((current) => {
      const next = current.includes(document.id) ? current.filter((id) => id !== document.id) : [...current, document.id];
      localStorage.setItem(`forma_selected_documents_${user.id}`, JSON.stringify(next));
      return next;
    });
  }

  function startStudyTask(content) {
    if (!selectedDocumentIds.length) {
      setError('Select at least one processed document first.');
      setStudyMenuOpen(false);
      return;
    }
    setStudyMenuOpen(false);
    sendMessage(content);
  }

  async function sendMessage(text = draft) {
    const content = text.trim();
    if (!content || sending) return;
    setError(''); setSending(true);
    let conversationId = activeId;
    try {
      if (!conversationId) {
        const created = await api('/conversations', { method: 'POST', body: '{}' });
        conversationId = created.conversation._id;
        setActiveId(conversationId);
        localStorage.setItem(`forma_last_conversation_${user.id}`, conversationId);
      }
      const data = await api(`/conversations/${conversationId}/messages`, {
        method: 'POST', body: JSON.stringify({ content, documentIds: selectedDocumentIds }),
      });
      setMessages((items) => [...items, ...data.messages]);
      setDraft('');
      setConversations((items) => {
        const existing = items.filter((item) => item.id !== conversationId);
        return [{ id: conversationId, title: data.title, updatedAt: new Date().toISOString(), messageCount: (items.find((item) => item.id === conversationId)?.messageCount || 0) + 2, preview: data.messages.at(-1).content }, ...existing];
      });
      textareaRef.current?.focus();
    } catch (sendError) {
      if (sendError.data?.persistedUserMessage) {
        setMessages((items) => [...items, sendError.data.persistedUserMessage]);
        setDraft('');
        setConversations((items) => {
          const current = items.find((item) => item.id === conversationId);
          return [{
            id: conversationId,
            title: sendError.data.conversationTitle || current?.title || 'New conversation',
            updatedAt: new Date().toISOString(),
            messageCount: (current?.messageCount || 0) + 1,
            preview: sendError.data.persistedUserMessage.content,
          }, ...items.filter((item) => item.id !== conversationId)];
        });
      }
      setError(sendError.message);
    }
    finally { setSending(false); }
  }

  function openRename(conversation) {
    setDialog({ type: 'rename', conversation });
    setDialogValue(conversation.title);
  }

  async function submitDialog(event) {
    event.preventDefault();
    if (!dialog) return;
    try {
      if (dialog.type === 'rename') {
        const data = await api(`/conversations/${dialog.conversation.id}`, { method: 'PATCH', body: JSON.stringify({ title: dialogValue }) });
        setConversations((items) => items.map((item) => item.id === dialog.conversation.id ? { ...item, title: data.conversation.title } : item));
      } else if (dialog.type === 'delete-document') {
        await api(`/documents/${dialog.document.id}`, { method: 'DELETE' });
        setDocuments((items) => items.filter((item) => item.id !== dialog.document.id));
        setSelectedDocumentIds((items) => {
          const next = items.filter((id) => id !== dialog.document.id);
          localStorage.setItem(`forma_selected_documents_${user.id}`, JSON.stringify(next));
          return next;
        });
        if (documentViewer?.document.id === dialog.document.id) setDocumentViewer(null);
      } else {
        await api(`/conversations/${dialog.conversation.id}`, { method: 'DELETE' });
        const remaining = conversations.filter((item) => item.id !== dialog.conversation.id);
        setConversations(remaining);
        if (activeId === dialog.conversation.id) {
          if (remaining[0]) await selectConversation(remaining[0].id);
          else { setActiveId(null); setMessages([]); localStorage.removeItem(`forma_last_conversation_${user.id}`); }
        }
      }
      setDialog(null); setError('');
    } catch (dialogError) { setError(dialogError.message); }
  }

  const activeConversation = conversations.find((conversation) => conversation.id === activeId);
  const filteredConversations = conversations.filter((conversation) => conversation.title.toLowerCase().includes(search.toLowerCase()));
  const isEmpty = !activeId || (!messages.length && !loadingConversation);

  return <main className="chat-shell">
    {sidebarOpen && <button className="chat-scrim" onClick={() => setSidebarOpen(false)} aria-label="Close sidebar"/>}
    <aside className={`chat-sidebar ${sidebarOpen ? 'chat-sidebar-open' : ''}`}>
      <div className="chat-sidebar-head"><a className="brand" href="#chat" aria-label="SONIC home"><span className="brand-mark"><span/><span/><span/><span/></span><span>SONIC</span></a><button className="sidebar-close icon-button" aria-label="Close sidebar" onClick={()=>setSidebarOpen(false)}><X size={17}/></button><span className="workspace-chip">PERSONAL</span></div>
      <button className="new-chat" onClick={newConversation}><MessageSquarePlus size={16}/><span>New chat</span><kbd>{navigator.platform.toLowerCase().includes('mac') ? '⌘ K' : 'Ctrl K'}</kbd></button>
      <div className="history-toolbar">{searchOpen ? <div className="history-search"><Search size={14}/><input autoFocus placeholder="Search chats" value={search} onChange={(event)=>setSearch(event.target.value)}/><button onClick={()=>{setSearchOpen(false);setSearch('');}} aria-label="Close search"><X size={13}/></button></div> : <><span>YOUR CHATS</span><button className="sidebar-tool" onClick={()=>setSearchOpen(true)} aria-label="Search conversations"><Search size={15}/></button></>}</div>
      <div className="chat-history" aria-label="Conversation history">{loadingHistory ? <div className="history-loading"><span className="mini-spinner"/>Loading conversations</div> : filteredConversations.length ? filteredConversations.map((conversation)=><div className={`chat-history-row ${conversation.id === activeId ? 'selected' : ''}`} key={conversation.id}><button className="history-select" onClick={()=>selectConversation(conversation.id)} title={conversation.title}><MessageSquare size={15}/><span>{conversation.title}</span></button><div className="history-actions"><button title="Rename conversation" aria-label={`Rename ${conversation.title}`} onClick={()=>openRename(conversation)}><Pencil size={13}/></button><button title="Delete conversation" aria-label={`Delete ${conversation.title}`} onClick={()=>setDialog({type:'delete',conversation})}><Trash2 size={13}/></button></div></div>) : <div className="history-empty">{search ? 'No matching chats.' : 'Your conversations will appear here.'}</div>}</div>
      <div className="documents-heading"><span>YOUR DOCUMENTS <small>{selectedDocumentIds.length} selected</small></span><button className="sidebar-tool" onClick={()=>documentInputRef.current?.click()} disabled={uploading} aria-label="Upload a PDF or DOCX" title="Upload PDF or DOCX">{uploading?<span className="mini-spinner"/>:<Upload size={14}/>}</button><input ref={documentInputRef} className="hidden-file-input" type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={uploadDocument}/></div>
      <div className="document-list" aria-label="Uploaded documents">{loadingDocuments?<div className="history-loading"><span className="mini-spinner"/>Loading documents</div>:documents.length?documents.map((document)=><div className={`document-row ${selectedDocumentIds.includes(document.id)?'document-selected':''}`} key={document.id}><button className="document-select" onClick={()=>toggleDocumentSelection(document)} disabled={document.status!=='ready'||document.needsReindex} aria-label={`${selectedDocumentIds.includes(document.id)?'Remove':'Add'} ${document.name} ${selectedDocumentIds.includes(document.id)?'from':'to'} chat context`} aria-pressed={selectedDocumentIds.includes(document.id)} title={document.needsReindex?'Re-upload to update embeddings':'Select for document chat'}>{selectedDocumentIds.includes(document.id)?<Check size={12}/>:<span/>}</button><button className="document-open" onClick={()=>openDocument(document)} title={`View ${document.name}`}><FileText size={14}/><span>{document.name}</span><i className={`document-status status-${document.status}`} title={document.needsReindex?'Re-upload to update embeddings':document.status}/></button><div className="document-actions"><button onClick={()=>openDocument(document)} title="View extracted text" aria-label={`View ${document.name}`}><Eye size={13}/></button><button onClick={()=>setDialog({type:'delete-document',document})} title="Delete document" aria-label={`Delete ${document.name}`}><Trash2 size={13}/></button></div></div>):<div className="document-empty">Upload PDFs or DOCX files to ask questions about them.</div>}</div>
      {documentNotice && <div className="document-notice" role="status">{documentNotice}<button onClick={()=>setDocumentNotice('')} aria-label="Dismiss notification"><X size={12}/></button></div>}
      {error && <div className="sidebar-error" role="alert">{error}</div>}
      <div className="sidebar-profile"><div className="profile-user"><span className="avatar">{initials}</span><span className="profile-copy"><strong>{user.name}</strong><small>{user.email}</small></span><button className="logout-button" onClick={onLogout} title="Sign out" aria-label="Sign out"><LogOut size={16}/></button></div><div className="profile-footnote"><Sparkles size={12}/> Your chats are private to your account.</div></div>
    </aside>

    <section className="chat-main">
      <header className="chat-topbar"><div className="chat-top-left"><button className="mobile-menu icon-button" onClick={()=>setSidebarOpen(true)} aria-label="Open conversation history"><Menu size={19}/></button><span className="chat-top-label">{activeConversation?.title || 'New chat'}</span><span className="preview-chip">MULTI-AGENT</span></div><div className="chat-top-right"><span className="connection-state"><i/> Saved to your account</span><button className="top-avatar" title={user.email}>{initials}</button></div></header>

      <section className="chat-scroll" ref={scrollRef}>
        {error && <div className="chat-error" role="alert"><span>{error}</span><button onClick={()=>setError('')} aria-label="Dismiss error"><X size={15}/></button></div>}
        {loadingConversation ? <div className="chat-load-state"><span className="mini-spinner"/>Loading conversation…</div> : isEmpty ? <div className="chat-welcome"><div className="welcome-orb"><Sparkles size={20}/></div><div className="welcome-kicker">SONIC · YOUR AI WORKSPACE</div><h1>What’s on your mind, {name}?</h1><p>Ask a question, shape an idea, or make a plan. Your chats stay saved to your account.</p><div className="starter-prompts"><button onClick={()=>sendMessage('Help me organize my thoughts about a new idea.')}><span>✳</span><strong>Explore an idea</strong><small>Think through something new</small><ArrowUp size={14}/></button><button onClick={()=>sendMessage('Help me turn this goal into a practical plan.')}><span>⌘</span><strong>Make a plan</strong><small>Break a goal into steps</small><ArrowUp size={14}/></button><button onClick={()=>sendMessage('Help me write a clear first draft.')}><span>✎</span><strong>Write something</strong><small>Start with a blank page</small><ArrowUp size={14}/></button></div><div className="preview-note"><span className="preview-note-dot"/>The Master Agent routes each message to the best specialist.</div></div> : <div className="message-thread">{messages.map((message)=><article className={`chat-message ${message.role === 'user' ? 'chat-message-user' : 'chat-message-assistant'}`} key={message._id}><div className="message-avatar">{message.role === 'user' ? initials : <span className="brand-mark mini-mark"><span/><span/><span/><span/></span>}</div><div className="message-body"><div className="message-byline">{message.role === 'user' ? user.name : message.agentNames?.length ? message.agentNames.join(' · ') : message.agentName || 'Master Agent'}<time>{new Date(message.createdAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}</time>{message.role==='assistant'&&<span className="response-status"><Check size={11}/>Complete</span>}</div><div className="markdown-content"><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown></div>{message.role==='assistant'&&message.agentResults?.length>0&&<details className="agent-results"><summary><BookOpenCheck size={13}/>{message.agentResults.length>1?'Agent collaboration':'Specialist result'}<small>{message.agentResults.length} {message.agentResults.length===1?'agent':'agents'}</small></summary><div className="agent-result-list">{message.agentResults.map((result,index)=><section key={`${result.agentName}-${index}`}><h4>{result.agentName}</h4><div className="markdown-content"><ReactMarkdown remarkPlugins={[remarkGfm]}>{result.content}</ReactMarkdown></div></section>)}</div></details>}{message.role==='assistant'&&message.sources?.length>0&&<div className="answer-sources"><span>Sources</span>{message.sources.map((source)=><button key={source.documentId} onClick={()=>openDocument({id:source.documentId,name:source.documentName})}><FileText size={12}/><strong>{source.documentName}</strong><small>{source.pageReferenceType==='estimated'?'~':''}p. {source.pageNumbers.join(', ')}</small></button>)}</div>}</div></article>)}{sending && <article className="chat-message chat-message-assistant"><div className="message-avatar"><span className="brand-mark mini-mark"><span/><span/><span/><span/></span></div><div className="message-body"><div className="message-byline">Master Agent <span className="typing-label">reviewing context and coordinating agents</span></div><div className="typing-indicator" aria-label="Waiting for response"><i/><i/><i/></div></div></article>}</div>}
      </section>

      <footer className="chat-composer-wrap"><div className="chat-composer"><div className="study-toolbar"><div className="study-menu-wrap"><button className="study-mode-button" onClick={()=>setStudyMenuOpen((open)=>!open)} aria-expanded={studyMenuOpen} aria-haspopup="menu"><BookOpenCheck size={14}/><span>Study Mode</span><small>{selectedDocumentIds.length} selected</small><ChevronDown size={12}/></button>{studyMenuOpen&&<div className="study-menu" role="menu"><div className="study-menu-title">Create from selected documents</div><button role="menuitem" onClick={()=>startStudyTask('Summarize the selected documents into clear study notes. Organize by main topic and cite each point with document and page references.')}><span>✦</span><div><strong>Summarize</strong><small>Key ideas and study notes</small></div></button><button role="menuitem" onClick={()=>startStudyTask('Create 10 multiple-choice questions from the selected documents. Include four options, mark the correct answer, and briefly explain it. Cite the relevant document and page for each answer.')}><span>☷</span><div><strong>Generate MCQs</strong><small>Questions with answers</small></div></button><button role="menuitem" onClick={()=>startStudyTask('Create a list of the most important exam questions answerable from the selected documents. Include concise answer outlines and document/page references.')}><span>◎</span><div><strong>Important questions</strong><small>Exam-focused prompts</small></div></button><button role="menuitem" onClick={()=>startStudyTask('Create a 10-question practice quiz using only the selected documents. Mix multiple-choice and short-answer questions, then include an answer key with page references.')}><span>✓</span><div><strong>Practice quiz</strong><small>Test understanding and recall</small></div></button></div>}</div><span className="selected-doc-hint">{selectedDocumentIds.length?`${selectedDocumentIds.length} document${selectedDocumentIds.length===1?'':'s'} in chat context`:'Select documents in the sidebar for document chat'}</span></div><textarea ref={textareaRef} value={draft} onChange={(event)=>setDraft(event.target.value)} onKeyDown={(event)=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendMessage();}}} placeholder="Message SONIC…" rows={1} aria-label="Message SONIC" maxLength={20000}/><div className="chat-composer-bottom"><span className="composer-hint">The Master Agent routes your request to specialists.</span><div className="composer-buttons"><span className="char-count">{draft.length ? `${draft.length.toLocaleString()} / 20,000` : 'Shift + Enter for a new line'}</span><button className="chat-send" onClick={()=>sendMessage()} disabled={!draft.trim()||sending} aria-label="Send message">{sending?<span className="mini-spinner light-spinner"/>:<ArrowUp size={17}/>}</button></div></div></div><div className="chat-disclaimer">Responses, agent contributions, and source references are saved with your conversation.</div></footer>
    </section>

    {dialog && <div className="dialog-backdrop" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget)setDialog(null);}}><form className="chat-dialog" role="dialog" aria-modal="true" aria-labelledby="conversation-dialog-title" onSubmit={submitDialog}><div className="dialog-icon">{dialog.type==='rename'?<Pencil size={17}/>:<Trash2 size={17}/>}</div><h2 id="conversation-dialog-title">{dialog.type==='rename'?'Rename conversation':dialog.type==='delete-document'?'Delete document?':'Delete conversation?'}</h2><p>{dialog.type==='rename'?'Choose a title that will be easy to find later.':dialog.type==='delete-document'?'This document and its extracted text and embeddings will be deleted.':'This conversation and its messages will be permanently deleted.'}</p>{dialog.type==='rename'&&<input autoFocus maxLength={100} value={dialogValue} onChange={(event)=>setDialogValue(event.target.value)} aria-label="Conversation title"/>}<div className="dialog-actions"><button type="button" className="dialog-cancel" onClick={()=>setDialog(null)}>Cancel</button><button type="submit" className={dialog.type!=='rename'?'dialog-delete':'dialog-confirm'} disabled={dialog.type==='rename'&&!dialogValue.trim()}>{dialog.type==='rename'?'Save title':dialog.type==='delete-document'?'Delete document':'Delete chat'}</button></div></form></div>}
    {documentViewer && <div className="dialog-backdrop document-backdrop" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget)setDocumentViewer(null);}}><section className="document-viewer" role="dialog" aria-modal="true" aria-labelledby="document-viewer-title"><header><span className="document-viewer-icon"><FileText size={17}/></span><div><h2 id="document-viewer-title">{documentViewer.document.name}</h2><p>{documentViewer.loading?'Loading extracted text…':`${documentViewer.document.pageCount} ${documentViewer.document.pageReferenceType==='estimated'?'estimated ':' '}page${documentViewer.document.pageCount===1?'':'s'} · ${documentViewer.document.chunkCount} chunks`}</p></div><button onClick={()=>setDocumentViewer(null)} aria-label="Close document viewer"><X size={17}/></button></header>{documentViewer.loading?<div className="document-viewer-loading"><span className="mini-spinner"/>Loading document text…</div>:documentViewer.chunks.length?<div className="document-excerpts">{documentViewer.chunks.map((chunk)=><article key={chunk._id}><div><span>CHUNK {chunk.chunkIndex+1}</span><b>{chunk.pageNumbers.map((page)=>`${chunk.pageReferenceType==='estimated'?'~':''}p. ${page}`).join(' · ')}</b></div><p>{chunk.text}</p></article>)}</div>:<div className="document-viewer-loading">No extracted text is available for this document.</div>}</section></div>}
  </main>;
}
