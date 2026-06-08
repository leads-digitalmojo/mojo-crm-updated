import React, { useState, useEffect, useRef } from 'react';
import Papa from 'papaparse';
import { Search, Plus, Filter, Download, Edit, Trash2, X, MoreHorizontal, ChevronDown, CheckSquare } from 'lucide-react';
import { Contact } from '../types';
import { useStore } from '../store/useStore';
import toast from 'react-hot-toast';
import { Modal } from '../components/Modal';
import { useParams, useNavigate } from 'react-router-dom';
import { COUNTRY_CODES } from '../utils/countryCodes';
import { format } from 'date-fns';

const Contacts: React.FC = () => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const { contacts, stages, opportunities, fetchContacts, fetchContact, searchContacts, addContact, updateContact, deleteContact, bulkDeleteContacts, isLoading, currentUser, hasMoreContacts, loadMoreContacts, addOpportunity, updateOpportunity } = useStore();
    const [searchTerm, setSearchTerm] = useState('');
    const [editingId, setEditingId] = useState<string | null>(null);
    const { id } = useParams();
    const navigate = useNavigate();

    // Selection State
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isBulkTagModalOpen, setIsBulkTagModalOpen] = useState(false);
    const [bulkTags, setBulkTags] = useState('');

    // Debounce search
    useEffect(() => {
        const delayDebounceFn = setTimeout(() => {
            if (searchTerm) {
                searchContacts(searchTerm);
            } else {
                fetchContacts();
            }
        }, 500);

        return () => clearTimeout(delayDebounceFn);
    }, [searchTerm, searchContacts, fetchContacts, currentUser]);

    // Form state
    const [countryCode, setCountryCode] = useState('+1');
    const [localPhone, setLocalPhone] = useState('');
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        companyName: '',
        type: '',

        Value: 'Standard',
        status: 'Active',
        notes: '',
        opportunityName: '',
        pipelineStage: '0'
    });

    // Initial fetch handled by search effect when term is empty, but we need to ensure it runs on mount if empty
    // Actually, the effect above runs on mount. If searchTerm is '', it calls fetchContacts().
    // So we can remove the separate useEffect for fetchContacts.

    useEffect(() => {
        const loadContact = async () => {
            if (id) {
                const contact = contacts.find(c => c.id === id);
                if (contact) {
                    handleOpenModal(contact);
                } else {
                    const fetchedContact = await fetchContact(id);
                    if (fetchedContact) {
                        handleOpenModal(fetchedContact);
                    } else {
                        toast.error('Contact not found');
                        navigate('/contacts');
                    }
                }
            }
        };
        loadContact();
    }, [id, contacts, fetchContact, navigate]);

    const [isFilterOpen, setIsFilterOpen] = useState(false);
    const filterRef = useRef<HTMLDivElement>(null);
    const [filterType, setFilterType] = useState('All');
    const [filterTag, setFilterTag] = useState('');

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
                setIsFilterOpen(false);
            }
        };

        if (isFilterOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isFilterOpen]);

    const filteredContacts = contacts.filter(contact => {
        // Search is now handled server-side, but we keep client-side filter for Type and Tag
        // const matchesSearch = contact.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        //     contact.email.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesType = filterType === 'All' || contact.type === filterType;

        const matchesValue = !filterTag || contact.Value === filterTag; // repurposed filterTag for Value temporarily or just ignore
        return matchesType; // Simplification: Removing tag filter logic for now as 'tags' array is gone.
    });

    // Infinite scroll refs
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const loadMoreSentinelRef = useRef<HTMLTableRowElement>(null);

    // Infinite scroll using IntersectionObserver
    useEffect(() => {
        const loadMoreElement = loadMoreSentinelRef.current;
        const scrollContainer = scrollContainerRef.current;

        if (!loadMoreElement || !scrollContainer) return;

        // Don't enable infinite scroll when searching or filtering
        if (searchTerm || filterType !== 'All' || filterTag) return;

        const observer = new IntersectionObserver(
            (entries) => {
                const [entry] = entries;
                if (entry.isIntersecting && hasMoreContacts && !isLoading) {
                    loadMoreContacts();
                }
            },
            {
                root: scrollContainer,
                rootMargin: '100px',
                threshold: 0.1
            }
        );

        observer.observe(loadMoreElement);

        return () => {
            observer.disconnect();
        };
    }, [hasMoreContacts, loadMoreContacts, isLoading, searchTerm, filterType, filterTag]);

    const handleOpenModal = (contact?: Contact) => {
        if (contact) {
            setEditingId(contact.id);

            // Parse phone number
            const matchingCode = COUNTRY_CODES.find(c => contact.phone && contact.phone.startsWith(c.code));
            if (matchingCode) {
                setCountryCode(matchingCode.code);
                setLocalPhone(contact.phone.slice(matchingCode.code.length));
            } else {
                setCountryCode('+1');
                setLocalPhone(contact.phone || '');
            }

            // Find linked opportunity to get pipeline stage
            const linkedOpportunity = opportunities.find(o => o.contactId === contact.id);

            setFormData({
                name: contact.name,
                email: contact.email,
                companyName: contact.companyName || '',
                type: contact.type || '',

                Value: contact.Value || 'Standard',
                status: contact.status || 'Active',
                notes: contact.notes || '',
                opportunityName: '',
                pipelineStage: linkedOpportunity?.stage || '0'
            });
        } else {
            setEditingId(null);
            setCountryCode('+1');
            setLocalPhone('');
            setFormData({ name: '', email: '', companyName: '', type: '', Value: 'Standard', status: 'Active', notes: '', opportunityName: '', pipelineStage: '0' });
        }
        setIsModalOpen(true);
    };

    const handleSubmit = async () => {
        if (!formData.name || !formData.email) {
            toast.error('Name and Email are required');
            return;
        }

        const contactData = {
            name: formData.name,
            email: formData.email,
            phone: countryCode + localPhone,
            companyName: formData.companyName,
            type: formData.type as Contact['type'],

            Value: (formData.Value || 'Standard') as 'Standard' | 'Mid' | 'High',
            status: formData.status,
            notes: formData.notes,
            owner: currentUser?.id || 'Unknown'
        };

        try {
            if (editingId) {
                await updateContact(editingId, contactData);

                // Update linked opportunity's pipeline stage
                const linkedOpportunity = opportunities.find(o => o.contactId === editingId);
                if (linkedOpportunity && linkedOpportunity.stage !== formData.pipelineStage) {
                    await updateOpportunity(linkedOpportunity.id, {
                        stage: formData.pipelineStage,
                        // Also update contact info on opportunity
                        contactName: contactData.name,
                        contactEmail: contactData.email,
                        contactPhone: contactData.phone,
                        companyName: contactData.companyName
                    });
                    toast.success('Contact and opportunity updated successfully');
                } else if (!linkedOpportunity) {
                    // No linked opportunity exists, create one
                    const opportunityName = formData.companyName || `${contactData.name}'s Opportunity`;
                    await addOpportunity({
                        name: opportunityName,
                        value: 0,
                        stage: formData.pipelineStage || '0',
                        status: 'Open',
                        owner: currentUser?.id || 'Unknown',
                        contactId: editingId,
                        contactName: contactData.name,
                        contactEmail: contactData.email,
                        contactPhone: contactData.phone,
                        companyName: contactData.companyName,
                        source: 'Contact Edit',
                        pipelineId: 'Marketing Pipeline',
                        tags: [],
                    } as any);
                    toast.success('Contact updated and opportunity created');
                } else {
                    toast.success('Contact updated successfully');
                }
            } else {
                const newContact = await addContact(contactData);
                toast.success('Contact created successfully');

                try {
                    // Auto-create Opportunity with user-specified name and pipeline stage
                    const opportunityName = formData.opportunityName || formData.companyName || `${contactData.name}'s Opportunity`;
                    await addOpportunity({
                        name: opportunityName,
                        value: 0,
                        stage: formData.pipelineStage || '0', // Use selected pipeline stage
                        status: 'Open',
                        owner: currentUser?.id || 'Unknown',
                        contactId: newContact.id,
                        contactName: newContact.name,
                        contactEmail: newContact.email,
                        contactPhone: newContact.phone,
                        companyName: contactData.companyName,
                        source: 'Contact Creation',
                        pipelineId: 'Marketing Pipeline',
                        tags: [],
                    } as any);
                    toast.success('Linked opportunity created');
                } catch (oppErr) {
                    console.error("Failed to auto-create opportunity", oppErr);
                }
            }
            setIsModalOpen(false);

            setFormData({ name: '', email: '', companyName: '', type: '', Value: 'Standard', status: 'Active', notes: '', opportunityName: '', pipelineStage: '0' });
            setCountryCode('+1');
            setLocalPhone('');
        } catch (error: any) {
            console.error('Error saving contact:', error);
            toast.error('Failed to save contact: ' + (error.message || 'Unknown error'));
        }
    };

    const handleDelete = async (id: string) => {
        if (window.confirm('Are you sure you want to delete this contact? This will also delete the linked opportunity.')) {
            try {
                await deleteContact(id);
                toast.success('Contact and linked opportunity deleted successfully');
                // Remove from selection if selected
                if (selectedIds.has(id)) {
                    const newSelected = new Set(selectedIds);
                    newSelected.delete(id);
                    setSelectedIds(newSelected);
                }
            } catch (error) {
                toast.error('Failed to delete contact');
            }
        }
    };

    // Bulk Actions Handlers
    const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.checked) {
            const allIds = new Set(filteredContacts.map(c => c.id));
            setSelectedIds(allIds);
        } else {
            setSelectedIds(new Set());
        }
    };

    const getInIST = (date: Date = new Date()) => {
    return new Date(date.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
};

const formatDisplayPhone = (phone: string | undefined | null) => {
    if (!phone) return '';
    const digits = phone.replace(/\D/g, '');
    if (digits.length > 10 && !phone.startsWith('+')) {
        return `+${digits.substring(0, digits.length - 10)} ${digits.substring(digits.length - 10)}`;
    }
    return phone;
};

    const handleSelectOne = (id: string) => {
        const newSelected = new Set(selectedIds);
        if (newSelected.has(id)) {
            newSelected.delete(id);
        } else {
            newSelected.add(id);
        }
        setSelectedIds(newSelected);
    };

    const handleBulkDelete = async () => {
        if (window.confirm(`Are you sure you want to delete ${selectedIds.size} contacts?`)) {
            try {
                await bulkDeleteContacts(Array.from(selectedIds));
                toast.success(`${selectedIds.size} contacts deleted successfully`);
                setSelectedIds(new Set());
            } catch (error) {
                toast.error('Failed to delete contacts');
            }
        }
    };



    // Import Handler
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: async (results) => {
                const rows = results.data as any[];
                let successCount = 0;
                let errorCount = 0;
                const toastId = toast.loading('Importing contacts...');

                console.log('Parsed CSV rows:', rows);

                for (const row of rows) {
                    try {
                        // Skip completely empty rows if any slipped through
                        if (Object.values(row).every(x => !x)) continue;

                        // Normalize keys to lowercase for flexible matching
                        const normalizedRow: any = {};
                        Object.keys(row).forEach(key => {
                            normalizedRow[key.toLowerCase().trim()] = row[key];
                        });

                        const name = normalizedRow['name'] || normalizedRow['contact name'] || normalizedRow['first name'];
                        const email = normalizedRow['email'] || normalizedRow['email address'];

                        if (!name && !email) {
                            console.warn('Skipping row due to missing name/email', row);
                            errorCount++;
                            continue;
                        }

                        const contactData: any = {
                            name: name || 'Unknown',
                            email: email || '',
                            phone: normalizedRow['phone'] || normalizedRow['phone number'] || normalizedRow['mobile'] || '',
                            companyName: normalizedRow['opportunity name'] || normalizedRow['opportunity'] || normalizedRow['company name'] || normalizedRow['company'] || '',
                            type: (normalizedRow['type'] || '') as any, // Default to empty if invalid/missing
                            Value: (normalizedRow['value'] || 'Standard') as any,
                            status: normalizedRow['status'] || 'Active',
                            notes: normalizedRow['notes'] || normalizedRow['description'] || '',
                            owner: currentUser?.id || 'Unknown'
                        };

                        // Basic Type validation/mapped fallback
                        const validTypes = ['Branding', 'Performance', 'Creative', '360'];
                        if (!validTypes.includes(contactData.type)) {
                            // Try to match partial or default
                            const found = validTypes.find(t => t.toLowerCase() === contactData.type.toLowerCase());
                            contactData.type = found || '';
                        }

                        // Basic Value validation
                        const validValues = ['Standard', 'Mid', 'High'];
                        if (!validValues.includes(contactData.Value)) {
                            contactData.Value = 'Standard';
                        }

                        try {
                            const newContact = await addContact(contactData);
                            successCount++;

                            // Auto-create Opportunity for imported contact
                            await addOpportunity({
                                name: contactData.companyName || `${contactData.name}'s Opportunity`,
                                value: 0,
                                stage: '0',
                                status: 'Open',
                                owner: currentUser?.id || 'Unknown',
                                contactId: newContact.id,
                                contactName: newContact.name,
                                contactEmail: newContact.email,
                                contactPhone: newContact.phone,
                                companyName: contactData.companyName,
                                source: 'Contact Import',
                                pipelineId: 'Marketing Pipeline',
                                tags: [],
                            } as any);

                        } catch (e) {
                            console.error("Failed to add contact or create opportunity", e);
                            errorCount++;
                        }
                    } catch (err) {
                        console.error("Error processing row:", row, err);
                        errorCount++;
                    }
                }

                toast.dismiss(toastId);
                if (successCount > 0) {
                    toast.success(`Successfully imported ${successCount} contacts`);
                }
                if (errorCount > 0) {
                    toast.error(`Failed to import ${errorCount} contacts`);
                }

                event.target.value = ''; // Reset input
            },
            error: (error) => {
                toast.error('Failed to parse CSV file');
                console.error(error);
            }
        });
    };

    return (
        <div className="p-8 h-full flex flex-col">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-4 mb-8 shrink-0">
                <h1 className="text-3xl font-bold text-gray-900">Contacts</h1>
                <div className="flex gap-3">
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-bold text-gray-700 hover:bg-gray-50 shadow-sm"
                    >
                        Import
                    </button>
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleImport}
                        accept=".csv"
                        className="hidden"
                    />
                    <button className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-bold text-gray-700 hover:bg-gray-50 shadow-sm">Export</button>
                    <button
                        onClick={() => handleOpenModal()}
                        className="px-4 py-2 bg-primary text-gray-900 rounded-lg text-sm font-bold hover:bg-primary/90 flex items-center gap-2 shadow-sm"
                    >
                        <Plus size={18} /> New Contact
                    </button>
                </div>
            </div>

            {/* Bulk Action Bar */}
            {selectedIds.size > 0 && (
                <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg mb-4 flex items-center justify-between animate-in fade-in slide-in-from-top-2">
                    <span className="text-sm font-medium text-blue-800">{selectedIds.size} contacts selected</span>
                    <div className="flex gap-2">

                        <button
                            onClick={handleBulkDelete}
                            className="px-3 py-1.5 bg-white border border-red-300 text-red-700 rounded text-sm font-medium hover:bg-red-50"
                        >
                            Delete Selected
                        </button>
                        <button
                            onClick={() => setSelectedIds(new Set())}
                            className="px-3 py-1.5 text-gray-500 hover:text-gray-700 text-sm"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {/* Filters */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col flex-1 min-h-0 overflow-hidden">
                <div className="p-4 border-b border-gray-200 flex flex-col gap-4 shrink-0" ref={filterRef}>
                    <div className="flex gap-4">
                        <div className="relative flex-1 max-w-md">
                            <Search className="absolute left-3 top-2.5 text-gray-400 h-5 w-5" />
                            <input
                                type="text"
                                placeholder="Search contacts..."
                                value={searchTerm}
                                onChange={(e) => {
                                    setSearchTerm(e.target.value);
                                }}
                                className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                            />
                        </div>
                        <div className="flex gap-2 relative">
                            <button
                                onClick={() => setIsFilterOpen(!isFilterOpen)}
                                className={`px-3 py-2 border rounded-lg text-gray-600 hover:bg-gray-100 flex items-center gap-2 ${isFilterOpen ? 'bg-gray-100 border-gray-400' : 'bg-gray-50 border-gray-300'}`}
                            >
                                <Filter size={20} /> Filters
                            </button>
                            <button className="px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-100"><Download size={20} /></button>
                        </div>
                    </div>

                    {/* Filter Panel */}
                    {isFilterOpen && (
                        <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 flex flex-wrap gap-4 animate-in fade-in slide-in-from-top-2 duration-200">
                            <div className="flex flex-col gap-1">
                                <label className="text-xs font-bold text-gray-500 uppercase">Type</label>
                                <select
                                    value={filterType}
                                    onChange={(e) => setFilterType(e.target.value)}
                                    className="p-2 border border-gray-300 rounded-md text-sm bg-white focus:ring-1 focus:ring-primary"
                                >
                                    <option value="All">All Types</option>
                                    <option value="">None</option>
                                    <option value="Branding">Branding</option>
                                    <option value="Performance">Performance</option>
                                    <option value="Creative">Creative</option>
                                    <option value="360">360</option>
                                </select>
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-xs font-bold text-gray-500 uppercase">Tag</label>
                                <input
                                    type="text"
                                    placeholder="Filter by tag..."
                                    value={filterTag}
                                    onChange={(e) => setFilterTag(e.target.value)}
                                    className="p-2 border border-gray-300 rounded-md text-sm bg-white focus:ring-1 focus:ring-primary"
                                />
                            </div>
                            <div className="flex items-end gap-2">
                                <button
                                    onClick={() => { setFilterType('All'); setFilterTag(''); }}
                                    className="text-sm text-red-500 hover:text-red-700 font-medium px-2 py-2"
                                >
                                    Clear Filters
                                </button>
                                <button
                                    onClick={() => setIsFilterOpen(false)}
                                    className="px-4 py-2 bg-primary text-gray-900 rounded-lg text-sm font-bold hover:bg-primary/90 shadow-sm"
                                >
                                    Done
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Table */}
                <div ref={scrollContainerRef} className="flex-1 overflow-auto">
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-gray-50 sticky top-0 z-10">
                            <tr>
                                <th className="p-4 border-b border-gray-200 w-8">
                                    <input
                                        type="checkbox"
                                        checked={filteredContacts.length > 0 && selectedIds.size === filteredContacts.length}
                                        onChange={handleSelectAll}
                                        className="rounded border-gray-300 text-brand-blue focus:ring-primary"
                                    />
                                </th>
                                <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">Name</th>
                                <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">Notes</th>
                                <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">Phone</th>

                                <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">Company</th>
                                <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">Type</th>

                                <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">Value</th>
                                <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">Email</th>
                                <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {filteredContacts.length === 0 ? (
                                <tr><td colSpan={8} className="p-8 text-center text-gray-500">No contacts found.</td></tr>
                            ) : (
                                <>
                                    {filteredContacts.map((contact) => (
                                        <tr key={contact.id} className={`hover:bg-gray-50 transition-colors group ${selectedIds.has(contact.id) ? 'bg-blue-50/50' : ''}`}>
                                            <td className="p-4">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedIds.has(contact.id)}
                                                    onChange={() => handleSelectOne(contact.id)}
                                                    className="rounded border-gray-300 text-brand-blue focus:ring-primary"
                                                />
                                            </td>
                                            <td className="p-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded-full bg-primary/10 text-brand-blue flex items-center justify-center font-bold text-xs">
                                                        {contact.name.charAt(0)}
                                                    </div>
                                                    <span className="font-medium text-gray-900">{contact.name}</span>
                                                </div>
                                            </td>
                                            <td className="p-4 text-sm text-gray-600 relative group/note">
                                                <div className="truncate max-w-[400px]">{contact.notes || '-'}</div>
                                                {contact.notes && (
                                                    <div className="absolute z-50 invisible group-hover/note:visible bg-gray-900 text-white p-3 rounded-lg shadow-xl text-xs -top-2 left-3/4 ml-2 w-72 break-words pointer-events-none">
                                                        <div className="font-bold mb-1 text-blue-400">
                                                            {contact.createdAt ? format(new Date(contact.createdAt), 'MMM d, h:mm a') : 'Note'}
                                                        </div>
                                                        {contact.notes}
                                                        <div className="absolute top-4 -left-1 w-2 h-2 bg-gray-900 rotate-45"></div>
                                                    </div>
                                                )}
                                            </td>

                                            <td className="p-4 text-sm text-gray-600">{formatDisplayPhone(contact.phone)}</td>
                                            <td className="p-4 text-sm text-gray-600">{contact.companyName || '-'}</td>
                                            <td className="p-4">
                                                <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${contact.type === 'Performance' ? 'bg-green-50 text-green-700 border-green-100' :
                                                    contact.type === 'Creative' ? 'bg-blue-50 text-blue-700 border-blue-100' :
                                                        'bg-gray-50 text-gray-700 border-gray-100'
                                                    }`}>
                                                    {contact.type}
                                                </span>
                                            </td>
                                            <td className="p-4">
                                                <span className={`px-2 py-1 text-xs font-medium rounded-full border ${contact.Value === 'High' ? 'bg-purple-50 text-purple-700 border-purple-100' :
                                                    contact.Value === 'Mid' ? 'bg-indigo-50 text-indigo-700 border-indigo-100' :
                                                        'bg-gray-50 text-gray-700 border-gray-100'
                                                    }`}>
                                                    {contact.Value}
                                                </span>
                                            </td>
                                            <td className="p-4 text-sm text-gray-600">{contact.email}</td>
                                            <td className="p-4 text-right">
                                                <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <button
                                                        onClick={() => handleOpenModal(contact)}
                                                        className="p-1 text-gray-400 hover:text-brand-blue rounded"
                                                        title="Edit"
                                                    >
                                                        <Edit size={16} />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDelete(contact.id)}
                                                        className="p-1 text-gray-400 hover:text-red-600 rounded"
                                                        title="Delete"
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                    {/* Sentinel row for infinite scroll */}
                                    {!searchTerm && filterType === 'All' && !filterTag && (
                                        <tr ref={loadMoreSentinelRef}>
                                            <td colSpan={9} className="h-4">
                                                {isLoading && hasMoreContacts && (
                                                    <div className="flex justify-center py-4">
                                                        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                    )}
                                </>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Bulk Tag Modal */}


            {/* Contact Modal */}
            <Modal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title={editingId ? 'Edit Contact' : 'New Contact'}
            >
                <div className="space-y-4">
                    <div className="grid grid-cols-1 gap-4">
                        <div>
                            <label className="block mb-2 text-sm font-medium text-gray-900">Name</label>
                            <input
                                type="text"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-primary focus:border-primary block w-full p-2.5"
                                placeholder="John Doe"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block mb-2 text-sm font-medium text-gray-900">Email</label>
                        <input
                            type="email"
                            value={formData.email}
                            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                            className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-primary focus:border-primary block w-full p-2.5"
                            placeholder="name@company.com"
                        />
                    </div>
                    <div>
                        <label className="block mb-2 text-sm font-medium text-gray-900">Phone Number</label>
                        <div className="flex gap-2">
                            <select
                                value={countryCode}
                                onChange={(e) => setCountryCode(e.target.value)}
                                className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-primary focus:border-primary block w-32 p-2.5"
                            >
                                {COUNTRY_CODES.map((country) => (
                                    <option key={country.name} value={country.code}>
                                        {country.flag} {country.name} ({country.code})
                                    </option>
                                ))}
                            </select>
                            <input
                                type="tel"
                                value={localPhone}
                                onChange={(e) => setLocalPhone(e.target.value)}
                                className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-primary focus:border-primary block w-full p-2.5"
                                placeholder="123 456 7890"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block mb-2 text-sm font-medium text-gray-900">Company Name</label>
                        <input
                            type="text"
                            value={formData.companyName}
                            onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                            className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-primary focus:border-primary block w-full p-2.5"
                            placeholder="Company Ltd."
                        />
                    </div>

                    {/* Opportunity Pipeline Stage - Show for both new and edit */}
                    <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg space-y-4">
                        <h4 className="text-sm font-bold text-blue-900 flex items-center gap-2">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                            {editingId ? 'Linked Opportunity Stage' : 'Linked Opportunity'}
                        </h4>
                        <div>
                            <label className="block mb-2 text-sm font-medium text-gray-900">Pipeline Stage</label>
                            <select
                                value={formData.pipelineStage}
                                onChange={(e) => setFormData({ ...formData, pipelineStage: e.target.value })}
                                className="bg-white border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-primary focus:border-primary block w-full p-2.5"
                            >
                                {stages.map((stage) => (
                                    <option key={stage.id} value={stage.id}>
                                        {stage.title}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block mb-2 text-sm font-medium text-gray-900">Type</label>
                            <select
                                value={formData.type}
                                onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                                className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-primary focus:border-primary block w-full p-2.5"
                            >
                                <option value="">Select Type</option>
                                <option value="Branding">Branding</option>
                                <option value="Performance">Performance</option>
                                <option value="Creative">Creative</option>
                                <option value="360">360</option>
                            </select>
                        </div>
                        <div>
                            <label className="block mb-2 text-sm font-medium text-gray-900">Value</label>
                            <select
                                value={formData.Value}
                                onChange={(e) => setFormData({ ...formData, Value: e.target.value })}
                                className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-primary focus:border-primary block w-full p-2.5"
                            >
                                <option value="Standard">Standard</option>
                                <option value="Mid">Mid</option>
                                <option value="High">High</option>
                            </select>
                        </div>
                    </div>

                    <div>
                        <label className="block mb-2 text-sm font-medium text-gray-900">Notes</label>
                        <textarea
                            value={formData.notes}
                            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                            className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-primary focus:border-primary block w-full p-2.5"
                            placeholder="Add notes about this contact..."
                            rows={3}
                        />
                    </div>
                    <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
                        <button
                            onClick={() => setIsModalOpen(false)}
                            className="text-gray-700 bg-white border border-gray-300 focus:ring-4 focus:outline-none focus:ring-gray-100 font-medium rounded-lg text-sm px-5 py-2.5 hover:bg-gray-50"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSubmit}
                            className="text-black bg-primary hover:bg-primary/90 focus:ring-4 focus:outline-none focus:ring-blue-300 font-medium rounded-lg text-sm px-5 py-2.5"
                        >
                            {editingId ? 'Update Contact' : 'Save Contact'}
                        </button>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default Contacts;
