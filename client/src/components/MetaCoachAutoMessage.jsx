
export default function MetaCoachAutoMessage() {
    return (
        <div className="max-w-xl mx-auto p-4 rounded-2xl shadow-md bg-white">
            <h3 className="text-xl font-semibold mb-3">Hi, I'm your Meta-Coach 👋</h3>

            <p className="mb-3 text-gray-700">
                I help you think clearly and move forward with:
            </p>

            <ul className="space-y-2 mb-4 text-gray-800">
                <li><span className="font-semibold">Goal Setting</span> — define and break down what you want</li>
                <li><span className="font-semibold">Decision Making</span> — evaluate choices with clarity</li>
                <li><span className="font-semibold">Habit Building</span> — reshape patterns and behaviors</li>
                <li><span className="font-semibold">Self-Awareness</span> — understand your thinking and drivers</li>
            </ul>

            <p className="text-sm text-gray-600 mb-2">
                <span className="font-semibold">Note:</span> My responses are based on your coaching knowledge base.
            </p>

            <p className="text-sm text-gray-600 mb-4">
                If something is missing, I’ll tell you directly.
            </p>

            <p className="font-semibold text-gray-900">What would you like to work on today?</p>
        </div>
    );
}

